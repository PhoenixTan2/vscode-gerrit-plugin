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
parser.add_argument('--locale', choices=['en','zh-cn'], default='en', help='VS Code locale for testing localized extension contributions')
parser.add_argument('--language-pack-vsix', type=Path, help='Install a VS Code language pack in the isolated profile')
parser.add_argument('--viewer-vsix', type=Path, help='Optional third-party Excel viewer VSIX, installed only in the isolated profile')
parser.add_argument('--hold-excel', type=int, default=0, choices=range(0,61), metavar='0..60', help='Keep Excel tabs visible briefly for visual inspection')
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
if options.viewer_vsix:
    with zipfile.ZipFile(options.viewer_vsix.resolve()) as archive:
        viewer = json.loads(archive.read('extension/package.json'))
        import re
        identity = f"{viewer['publisher']}.{viewer['name']}-{viewer['version']}"
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', identity):
            sys.exit('Invalid viewer identity')
        destination = temporary / 'extensions' / identity
        for item in archive.infolist():
            if not item.filename.startswith('extension/') or item.is_dir():
                continue
            relative = item.filename[len('extension/'):]
            target = (destination / relative).resolve()
            if not target.is_relative_to(destination.resolve()):
                sys.exit('Unsafe viewer VSIX member path')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(item))
    # Valid OOXML fixtures, generated only for the integration test.
    from excel_fixture import workbook
    fixtures = temporary / 'excel-fixtures'
    fixtures.mkdir()
    (fixtures / 'old.xlsx').write_bytes(workbook('OLD', 10))
    (fixtures / 'new.xlsx').write_bytes(workbook('NEW', 20))

env = {name: value for name, value in os.environ.items() if name != 'ELECTRON_RUN_AS_NODE' and not name.startswith('VSCODE_')}
env['GERRIT_HOST_SMOKE_RESULT'] = str(result)
manifest = json.loads((development / 'package.json').read_text(encoding='utf-8'))
env['GERRIT_HOST_SMOKE_EXTENSION'] = f"{manifest['publisher']}.{manifest['name']}"
profile = temporary / 'profile'
if options.locale != 'en':
    # Keep argv.json and the language pack registry separate from the user's VS Code profile.
    env['VSCODE_PORTABLE'] = str(temporary)
    profile = temporary / 'user-data'
    (temporary / 'argv.json').write_text(json.dumps({'locale': options.locale}), encoding='utf-8')
if options.viewer_vsix:
    env['GERRIT_EXCEL_FIXTURES'] = str(fixtures)
    env['GERRIT_EXCEL_HOLD'] = str(options.hold_excel)
    env['GERRIT_EXCEL_VIEWER'] = f"{viewer['publisher']}.{viewer['name']}"
# Reproduce an installed Gerrit extension owning the old generic container ID.
legacy = temporary / 'extensions' / 'smoke-test.legacy-gerrit-1.0.0'
legacy.mkdir(parents=True)
(legacy / 'package.json').write_text(json.dumps({
    'name': 'legacy-gerrit', 'publisher': 'smoke-test', 'version': '1.0.0',
    'engines': {'vscode': '^1.95.0'},
    'contributes': {'viewsContainers': {'activitybar': [{'id': 'gerrit', 'title': 'Legacy Gerrit', 'icon': 'icon.svg'}]}, 'views': {'gerrit': [{'id': 'legacy.gerrit.changes', 'name': 'Legacy Changes'}]}}
}), encoding='utf-8')
(legacy / 'icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ccc" d="M4 4h16v16H4z"/></svg>', encoding='utf-8')
args = [str(code), '--locale=' + options.locale, '--new-window','--disable-extension=GitHub.copilot-chat','--disable-extension=GitHub.copilot', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--user-data-dir=' + str(profile), '--extensions-dir=' + str(temporary / 'extensions'), '--extensionDevelopmentPath=' + str(development), '--extensionTestsPath=' + str(root / 'scripts/extension-host-smoke.js')]
if options.language_pack_vsix:
    cli = code.parent / 'bin' / 'code.cmd'
    subprocess.run([str(cli), '--user-data-dir', str(profile), '--extensions-dir', str(temporary / 'extensions'), '--install-extension', str(options.language_pack_vsix.resolve())], env=env, check=True, timeout=45)

def run_host(log_name):
    result.unlink(missing_ok=True)
    with (temporary / log_name).open('w', encoding='utf-8') as log:
        process = subprocess.Popen(args, env=env, stdout=log, stderr=log)
        deadline = time.monotonic() + 120 + options.hold_excel
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
    return report

report = run_host('process.log')
if options.language_pack_vsix and report['locale'].lower() != options.locale:
    # A fresh profile may register its installed language pack during the first launch.
    report = run_host('process-locale-retry.log')
if report['locale'].lower() != options.locale:
    sys.exit(f"Requested VS Code locale {options.locale}, but the host used {report['locale']}. Supply a matching language pack. Isolated logs: {temporary}")
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
print(f"Real Extension Host OK: VS Code {report['vscode']} ({report['locale']}), Gerrit Workbench {report['extension']}")

if options.viewer_vsix:
    print(f"Excel integration OK: {viewer['publisher']}.{viewer['name']} {viewer['version']}; {report.get('excel')}")
