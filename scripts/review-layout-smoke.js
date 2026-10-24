'use strict';
const assert=require('node:assert/strict');
const vscode=require('vscode');
const crypto=require('node:crypto');
async function run(extension){
 const panels=[];
 async function check(column){
  const panel=vscode.window.createWebviewPanel('gerrit.layout.smoke','Floating review layout',column,{enableScripts:true,localResourceRoots:[extension.extensionUri]});panels.push(panel);
  const nonce=crypto.randomBytes(16).toString('hex'),asset=name=>panel.webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri,'media',name));
  const model={connected:true,surface:'discussion',detail:{id:'layout',status:'NEW',current_revision:'r',revisions:{r:{_number:1}},labels:{'Code-Review':{all:[{name:'Reviewer',value:1}]}},permitted_labels:{'Code-Review':['-1','0','1'],Verified:['-1','0','1']},comments:{},messages:Array.from({length:50},(_,i)=>({author:{name:'Reviewer'},message:'Activity '+i}))}};
  const finished=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Floating layout timed out')),10000);
   panel.webview.onDidReceiveMessage(message=>{if(message.type==='layoutDone'){clearTimeout(timer);message.error?reject(Error(message.error)):resolve(message);}});
  });
  const script=`(async()=>{try{
   window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:${JSON.stringify(model)}}}));
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const floating=document.querySelector('.review-float'),reader=document.getElementById('app'),before=floating.getBoundingClientRect();
   if(getComputedStyle(floating).position!=='fixed')throw Error('Review window is not fixed');
   window.scrollTo(0,document.documentElement.scrollHeight);
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const rect=floating.getBoundingClientRect();
   if(Math.abs(rect.top-before.top)>1||rect.top<0||rect.bottom>innerHeight+1)throw Error('Floating review leaves viewport');
   if(Math.abs((rect.top+rect.bottom)/2-document.documentElement.clientHeight/2)>1||Math.abs(document.documentElement.clientWidth-rect.right-12)>1)throw Error('Review window is not right-centred: '+JSON.stringify({rect:rect.toJSON(),width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,innerWidth,innerHeight}));
   if(innerWidth>760&&document.querySelector('.discussion-layout').getBoundingClientRect().right>rect.left)throw Error('Right review window covers discussions');
   const hit=document.elementFromPoint(rect.left+10,rect.top+10);if(!hit?.closest('.review-float'))throw Error('Floating review is clipped or obscured');
   if(!floating.querySelector('#review')||!floating.querySelector('.ratings'))throw Error('Review/votes missing from floating window');
   const input=floating.querySelector('#review-message');input.value='keep unsent comment';floating.querySelector('[data-action="toggleReviewWindow"]').click();if(!floating.querySelector('.review-window-body').hidden)throw Error('Review window cannot collapse');floating.querySelector('[data-action="toggleReviewWindow"]').click();if(input!==floating.querySelector('#review-message')||input.value!=='keep unsent comment')throw Error('Collapsing loses review draft');

   vscode.postMessage({type:'layoutDone',width:innerWidth,mode:'right-center'});
  }catch(error){vscode.postMessage({type:'layoutDone',error:error.message});}})();`;
  panel.webview.html=`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset('style.css')}"></head><body><div id="account"></div><div id="notice"></div><main id="app"></main><script nonce="${nonce}" src="${asset('vendor/markdown-it.min.js')}"></script><script nonce="${nonce}" src="${asset('i18n.js')}"></script><script nonce="${nonce}" src="${asset('main.js')}"></script><script nonce="${nonce}">${script}</script></body></html>`;
  return finished;
 }
 try{
  await vscode.commands.executeCommand('workbench.action.joinAllGroups');
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await vscode.commands.executeCommand('workbench.action.closePanel');
  const wide=await check(vscode.ViewColumn.Active);assert.equal(wide.mode,'right-center');
  let narrow;
  for(let i=0;i<4;i++){narrow=await check(vscode.ViewColumn.Beside);if(narrow.width<=760)break;}
  assert.ok(narrow.width<=760,'Must test a narrow viewport');assert.equal(narrow.mode,'right-center');
  console.log(`Floating review layout OK: right-centred at ${wide.width}px / ${narrow.width}px`);
 }finally{for(const panel of panels)panel.dispose();}
}
module.exports={run};
