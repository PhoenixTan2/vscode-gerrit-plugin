"""Run a real VS Code Extension Host smoke test in an isolated temporary profile."""
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--vsix', type=Path, help='Validate the packaged extension instead of workspace sources')
options = parser.parse_args()
candidates = [Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Microsoft VS Code/Code.exe', Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs/Microsoft VS Code/Code.exe']
code = next((p for p in candidates if p.is_file()), None)
if code is None:
    sys.exit('VS Code desktop is required for the Extension Host smoke test')
temporary = Path(tempfile.mkdtemp(prefix='gerrit-host-smoke-')).resolve()
result = temporary / 'result.json'
development = root
if options.vsix:
    extracted = temporary / 'package'
    with zipfile.ZipFile(options.vsix.resolve()) as archive:
        for item in archive.infolist():
            resolved = (extracted / item.filename).resolve()
            if not resolved.is_relative_to(extracted.resolve()):
                sys.exit('Unsafe VSIX member path')
        archive.extractall(extracted)
    development = extracted / 'extension'
env = os.environ.copy()
env.pop('ELECTRON_RUN_AS_NODE', None)
env['GERRIT_HOST_SMOKE_RESULT'] = str(result)
args = [str(code), '--new-window', '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--user-data-dir=' + str(temporary / 'profile'), '--extensions-dir=' + str(temporary / 'extensions'), '--extensionDevelopmentPath=' + str(development), '--extensionTestsPath=' + str(root / 'scripts/extension-host-smoke.js')]
with (temporary / 'process.log').open('w', encoding='utf-8') as log:
    process = subprocess.Popen(args, env=env, stdout=log, stderr=log)
    deadline = time.monotonic() + 120
    while not result.is_file() and time.monotonic() < deadline:
        time.sleep(1)
    if not result.is_file():
        process.terminate()
        sys.exit(f'Extension Host test timed out. Isolated logs: {temporary}')
    report = json.loads(result.read_text(encoding='utf-8'))
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        process.terminate()
        sys.exit(f'Extension Host did not exit. Isolated logs: {temporary}')
if not report.get('ok'):
    sys.exit(f"Extension Host failed: {report.get('message')}\nIsolated logs: {temporary}")
if process.returncode != 0:
    sys.exit(f'Extension Host exit code {process.returncode}. Isolated logs: {temporary}')
print(f"Real Extension Host OK: VS Code {report['vscode']}, Gerrit Workbench {report['extension']}")
if temporary.parent != Path(tempfile.gettempdir()).resolve() or not temporary.name.startswith('gerrit-host-smoke-'):
    sys.exit('Refusing cleanup outside the generated test directory')
shutil.rmtree(temporary)
