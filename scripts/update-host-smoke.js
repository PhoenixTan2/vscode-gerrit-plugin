"use strict";
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),vscode=require('vscode');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function health(){
 await vscode.commands.executeCommand('workbench.view.extension.gerritWorkbench');
 await vscode.commands.executeCommand('gerrit.dashboard.focus');
 for(let i=0;i<100;i++){const value=await vscode.commands.executeCommand('gerrit._viewStatus');if(value.error)throw Error(value.error);if(value.ready)return value;await pause(100);}
 throw Error('Workbench client did not become ready');
}
async function run(){
 const report={vscode:vscode.version,phases:[],noWindowReload:false};
 const config=vscode.workspace.getConfiguration('gerrit');
 try{
  const extension=vscode.extensions.getExtension('local-tools.gerrit-workbench');
  if(!extension)throw Error('Previous installed extension missing');
  await extension.activate();
  await config.update('language','en',vscode.ConfigurationTarget.Global);
  const previousHealth=await health();
  report.phases.push({phase:'previous',health:previousHealth});
  for(const [phase,file,expected] of [['update',process.env.GERRIT_UPDATE_NEXT,true],['rollback',process.env.GERRIT_UPDATE_PREVIOUS,false]]){
   await vscode.commands.executeCommand('workbench.extensions.installExtension',vscode.Uri.file(file));
   await pause(2500);
   const current=vscode.extensions.getExtension(extension.id);
   const installedPath=path.join(process.env.GERRIT_UPDATE_EXTENSIONS,extension.id+'-'+(expected?process.env.GERRIT_UPDATE_VERSION:process.env.GERRIT_UPDATE_PREVIOUS_VERSION));
   const fingerprint=crypto.createHash('sha256');
   for(const name of ['src/api.js','src/extension.js'])fingerprint.update(fs.readFileSync(path.join(installedPath,name)));
   const disk=fingerprint.digest('hex');
   const state=await health();
   const runtimeMatches=expected?state.runtimeVersion===process.env.GERRIT_UPDATE_VERSION:state.runtimeVersion===previousHealth.runtimeVersion;
   const diskMatches=disk===(expected?process.env.GERRIT_UPDATE_NEXT_SHA:process.env.GERRIT_UPDATE_PREVIOUS_SHA);
   report.phases.push({phase,disk,registeredVersion:current.packageJSON.version,health:state,runtimeMatches,diskMatches,languagePreserved:vscode.workspace.getConfiguration('gerrit').get('language')==='en'});
  }
  report.noWindowReload=report.phases.slice(1).every(item=>item.runtimeMatches&&item.diskMatches&&item.languagePreserved);
  report.rollbackAccepted=report.noWindowReload;
  report.ok=true;
  report.limit=report.noWindowReload?'Runtime fingerprint changed in the same running window.':'Installed files and the running extension can differ; no-reload update acceptance is not met. Connection, discussion, native comments and diff migration cannot be accepted until the new runtime is active.';
 }catch(error){report.ok=false;report.message=error.stack||error.message;}
 fs.writeFileSync(process.env.GERRIT_UPDATE_RESULT,JSON.stringify(report,null,2));
 if(!report.ok)throw Error(report.message);
}
module.exports={run};
