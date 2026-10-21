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
# Reproduce an installed Gerrit extension owning the old generic container ID.
legacy = temporary / 'extensions' / 'smoke-test.legacy-gerrit-1.0.0'
legacy.mkdir(parents=True)
(legacy / 'package.json').write_text(json.dumps({
    'name': 'legacy-gerrit', 'publisher': 'smoke-test', 'version': '1.0.0',
    'engines': {'vscode': '^1.95.0'},
    'contributes': {'viewsContainers': {'activitybar': [{'id': 'gerrit', 'title': 'Legacy Gerrit', 'icon': 'icon.svg'}]}, 'views': {'gerrit': [{'id': 'legacy.gerrit.changes', 'name': 'Legacy Changes'}]}}
}), encoding='utf-8')
(legacy / 'icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ccc" d="M4 4h16v16H4z"/></svg>', encoding='utf-8')
args = [str(code), '--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--user-data-dir=' + str(temporary / 'profile'), '--extensions-dir=' + str(temporary / 'extensions'), '--extensionDevelopmentPath=' + str(development), '--extensionTestsPath=' + str(root / 'scripts/extension-host-smoke.js')]
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
if temporary.parent != Path(tempfile.gettempdir()).resolve() or not temporary.name.startswith('gerrit-host-smoke-'):
    sys.exit('Refusing cleanup outside the generated test directory')
for attempt in range(10):
    try:
        shutil.rmtree(temporary)
        break
    except PermissionError:
        if attempt == 9:
            raise
        time.sleep(0.2)
print(f"Real Extension Host OK: VS Code {report['vscode']}, Gerrit Workbench {report['extension']}")
