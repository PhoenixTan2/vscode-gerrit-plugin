"""Exercise installed old/new VSIX replacements in one isolated running VS Code window.
Runtime health versions are compared before and after each installation.
A completed test can still report noWindowReload=false: do not call that acceptance passed.
"""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,tempfile,time,zipfile
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
p.add_argument('--previous',required=True,type=Path)
p.add_argument('--vsix',required=True,type=Path)
p.add_argument('--report',type=Path)
a=p.parse_args()
code=next((x for x in [Path(os.environ.get('ProgramFiles','C:/Program Files'))/'Microsoft VS Code/Code.exe',Path(os.environ.get('LOCALAPPDATA',''))/'Programs/Microsoft VS Code/Code.exe'] if x.is_file()),None)
if not code:raise SystemExit('VS Code desktop required')
temporary=Path(tempfile.mkdtemp(prefix='gerrit-update-smoke-'))
extensions=temporary/'extensions'
with zipfile.ZipFile(a.previous.resolve()) as archive:
 package=json.loads(archive.read('extension/package.json'))
 destination=extensions/(package['publisher']+'.'+package['name']+'-'+package['version'])
 for item in archive.infolist():
  if not item.filename.startswith('extension/') or item.is_dir():continue
  target=(destination/item.filename[len('extension/'):]).resolve()
  if not target.is_relative_to(destination.resolve()):raise SystemExit('Unsafe VSIX path')
  target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.read(item))
controller=temporary/'controller';controller.mkdir()
(controller/'package.json').write_text(json.dumps({'publisher':'smoke-test','name':'update-controller','version':'1.0.0','engines':{'vscode':'^1.95.0'},'main':'index.js','activationEvents':['*']}),encoding='utf-8')
(controller/'index.js').write_text('exports.activate=()=>{};',encoding='utf-8')
result=temporary/'result.json'
env=os.environ.copy();env.pop('ELECTRON_RUN_AS_NODE',None)
with zipfile.ZipFile(a.vsix.resolve()) as archive:
 next_version=json.loads(archive.read('extension/package.json'))['version']
 next_sha=hashlib.sha256(b''.join(archive.read('extension/'+name) for name in ['src/api.js','src/extension.js'])).hexdigest()
with zipfile.ZipFile(a.previous.resolve()) as archive:
 previous_sha=hashlib.sha256(b''.join(archive.read('extension/'+name) for name in ['src/api.js','src/extension.js'])).hexdigest()
env.update(GERRIT_UPDATE_EXTENSIONS=str(extensions),GERRIT_UPDATE_PREVIOUS_VERSION=package['version'],GERRIT_UPDATE_VERSION=next_version,GERRIT_UPDATE_NEXT_SHA=next_sha,GERRIT_UPDATE_PREVIOUS_SHA=previous_sha,GERRIT_UPDATE_RESULT=str(result),GERRIT_UPDATE_NEXT=str(a.vsix.resolve()),GERRIT_UPDATE_PREVIOUS=str(a.previous.resolve()))
args=[str(code),'--new-window','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--user-data-dir='+str(temporary/'profile'),'--extensions-dir='+str(extensions),'--extensionDevelopmentPath='+str(controller),'--extensionTestsPath='+str(root/'scripts/update-host-smoke.js')]
with (temporary/'process.log').open('w',encoding='utf-8') as log:
 process=subprocess.Popen(args,env=env,stdout=log,stderr=log)
 deadline=time.monotonic()+100
 while not result.exists() and time.monotonic()<deadline:time.sleep(0.5)
 if not result.exists():
  process.terminate();raise SystemExit('Update test timed out; logs: '+str(temporary))
 report=json.loads(result.read_text(encoding='utf-8'))
 try:process.wait(timeout=15)
 except subprocess.TimeoutExpired:process.terminate()
if a.report:a.report.write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2));print('Isolated logs: '+str(temporary))
if not report.get('ok'):raise SystemExit(1)
if not report.get('noWindowReload'):raise SystemExit(2)
