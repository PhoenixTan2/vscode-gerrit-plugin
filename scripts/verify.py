"""Run syntax and behavior checks with Node, falling back to VS Code's Node runtime."""
from pathlib import Path
import os
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
node = shutil.which('node')
env = os.environ.copy()
if not node:
    candidates = [Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Microsoft VS Code/Code.exe', Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs/Microsoft VS Code/Code.exe']
    node = next((str(p) for p in candidates if p.is_file()), None)
    env['ELECTRON_RUN_AS_NODE'] = '1'
if not node:
    sys.exit('Node.js or VS Code is required')
def run(args):
    result = subprocess.run([node, *args], cwd=root, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
    print(result.stdout, end='')
    if result.returncode:
        print(result.stderr, file=sys.stderr, end='')
        sys.exit(result.returncode)

for file in [*sorted((root / 'src').glob('*.js')), *sorted((root / 'media').glob('*.js')), *sorted((root / 'media').glob('*.mjs'))]:
    run(['--check', str(file)])
run(['--test', *map(str, sorted((root / 'test').glob('*.test.js')))])
print('All checks passed.')
