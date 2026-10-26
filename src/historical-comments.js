'use strict';
// Gerrit's shared/skip blocks identify unchanged lines. Replaced or deleted code
// is deliberately left as a document-level comment, never pinned to a guess.
function lineMap(diff) {
  if (!Array.isArray(diff?.content)) return;
  const spans=[];let a=1,b=1;
  for(const part of diff.content){
    const shared=Array.isArray(part.ab)?part.ab.length:Number.isSafeInteger(part.skip)&&part.skip>=0?part.skip:0;
    if(shared){spans.push({first:a,last:a+shared-1,offset:b-a});a+=shared;b+=shared;}
    a+=Array.isArray(part.a)?part.a.length:0;b+=Array.isArray(part.b)?part.b.length:0;
  }
  return {spans,sourcePath:diff.meta_a?.name,targetPath:diff.meta_b?.name};
}
function mappedPosition(comment,mapping,lineCount=Infinity){
  const first=comment.range?.start_line||comment.line,last=comment.range?.end_line||comment.line;
  if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first)return;
  const span=mapping?.identity?{first:1,last:Infinity,offset:0}:mapping?.spans?.find(span=>first>=span.first&&last<=span.last);
  if(!span||last+span.offset>lineCount)return;
  return {line:comment.line?comment.line+span.offset:undefined,range:comment.range?{...comment.range,start_line:first+span.offset,end_line:last+span.offset}:undefined};
}
function pathAliases(selection,info){
  const aliases=new Set([info.path,info.contentPath].filter(Boolean)),renames=[];
  for(const files of [selection.files,...Object.values(selection.change.revisions||{}).map(revision=>revision.files)])for(const [path,file] of Object.entries(files||{}))if(file.old_path&&file.status!=='C')renames.push([path,file.old_path]);
  let changed=true;while(changed){changed=false;for(const [a,b] of renames)if(aliases.has(a)||aliases.has(b))for(const path of [a,b])if(!aliases.has(path)){aliases.add(path);changed=true;}}
  return aliases;
}
async function historicalComments(app,info,{signal}={}){
  const selection=app.selected,api=app.api,revisions=selection.change.revisions||{},target=revisions[info.rev];
  if(!info.historyTarget||!target||info.empty||info.editHead)return [];
  const aliases=pathAliases(selection,info),excluded=new Set(info.historyExcluded||[]),jobs=[];
  for(const [sourceRev,revision] of Object.entries(revisions)){
    if(!(revision._number<target._number)||excluded.has(revision._number))continue;
    const comments=Object.entries(selection.comments||{}).filter(([path])=>aliases.has(path)).flatMap(([path,list])=>list.filter(comment=>comment.patch_set===revision._number&&(comment.side||'REVISION')===info.side).map(comment=>({path,comment})));
    if(comments.length)jobs.push({sourceRev,revision,comments});
  }
  const result=[];let next=0;
  app.historicalDiffs ||= new Map();
  async function mappingFor(job){
    const sourceParent=job.revision.commit?.parents?.[0]?.commit,targetParent=target.commit?.parents?.[0]?.commit;
    if(info.side==='PARENT'&&sourceParent&&sourceParent===targetParent)return {identity:true,sourcePath:info.contentPath||info.path};
    const key=JSON.stringify([api.url,app.user?._account_id,selection.id,info.rev,info.side,info.contentPath||info.path,job.sourceRev]);
    let pending=app.historicalDiffs.get(key);
    if(!pending){
      pending=(async()=>{
        let diff;
        if(info.side==='PARENT'){
          if(!sourceParent||!targetParent||typeof api.commitDiff!=='function')return;
          diff=await api.commitDiff(selection.change.project,targetParent,info.contentPath||info.path,sourceParent,{signal});
        }else{
          if(typeof api.diff!=='function')return;
          diff=await api.diff(selection.id,info.rev,info.contentPath||info.path,job.sourceRev,{signal});
        }
        return lineMap(diff);
      })();
      app.historicalDiffs.set(key,pending);
      pending.catch(()=>{if(app.historicalDiffs.get(key)===pending)app.historicalDiffs.delete(key);});
      if(app.historicalDiffs.size>128)app.historicalDiffs.delete(app.historicalDiffs.keys().next().value);
    }
    return pending;
  }
  await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{
    while(next<jobs.length){
      signal?.throwIfAborted();const job=jobs[next++];let mapping;
      try{mapping=await mappingFor(job);}catch(error){if(signal?.aborted)throw error;}
      for(const {path,comment} of job.comments){
        const sourcePath=info.side==='PARENT'?(job.revision.files?.[path]?.old_path||path):path;
        const sameFile=mapping?.sourcePath===sourcePath&&(mapping.identity||mapping.targetPath===(info.contentPath||info.path));
        const position=sameFile?mappedPosition(comment,mapping,String(info.content||'').split(/\r?\n/).length):undefined;
        result.push({...comment,line:position?.line,range:position?.range,_origin:{rev:job.sourceRev,patch:job.revision._number,path,side:info.side,comment,unmapped:!!(comment.line||comment.range)&&!position,unavailable:!mapping}});
      }
    }
  }));
  return result.sort((a,b)=>a._origin.patch-b._origin.patch||String(a.updated).localeCompare(String(b.updated)));
}
module.exports={lineMap,mappedPosition,pathAliases,historicalComments};
