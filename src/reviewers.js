'use strict';
const {tr} = require('./i18n');
function owned(app, selected = app.selected, api = app.api) {
  if (!selected || app.disposed || !api || app.api !== api || app.selected !== selected) throw new Error(tr('页面已更新，请重新选择变更后操作'));
  if (!Number.isInteger(app.user?._account_id) || selected.change.owner?._account_id !== app.user._account_id) throw new Error(tr('只能管理自己的提交的评审人员'));
  if (app.model.detail?.viewRevision && app.model.detail.viewRevision !== selected.rev) throw new Error(tr('当前查看历史 PS，请先切换到最新 PS 后执行变更操作'));
  if (selected.change.status !== 'NEW') throw new Error(tr('只能管理未关闭提交的评审人员'));
  return {selected, api};
}
function candidate(item) {
  if (Number.isInteger(item.account?._account_id)) return {kind:'account',id:String(item.account._account_id),name:item.account.name||item.account.username||item.account.email||String(item.account._account_id),description:item.account.email||item.account.username||''};
  if (item.group?.id) return {kind:'group',id:item.group.id,name:item.group.name||item.group.id,count:item.count,confirm:!!item.confirm};
}
async function suggestReviewers(app, message) {
  const result={type:'reviewerSuggestions',id:message.id,rev:message.rev,requestId:message.requestId,clientId:message.clientId,items:[]};
  const {selected,api}=owned(app);
  if(typeof message.clientId!=='string'||message.clientId.length>64||!message.clientId)return;
  app.reviewerSuggestionClients ||= new Map();
  app.reviewerRequests ||= new Map();app.reviewerRequests.get(message.clientId)?.abort();
  const controller=new AbortController();app.reviewerRequests.set(message.clientId,controller);
  app.reviewerController={abort(){for(const request of app.reviewerRequests.values())request.abort();app.reviewerRequests.clear();}};
  if(app.reviewerRequests.size>8){const oldest=app.reviewerRequests.keys().next().value;app.reviewerRequests.get(oldest).abort();app.reviewerRequests.delete(oldest);}
  if (selected.id!==message.id||selected.rev!==message.rev||!Number.isSafeInteger(message.requestId)) return;
  const query=String(message.query||'').trim().slice(0,200);
  try {
    const items=query?(await api.suggestReviewers(selected.id,query,{signal:controller.signal})).map(candidate).filter(Boolean):[];
    owned(app,selected,api);if(controller.signal.aborted)return;
    app.reviewerSuggestionClients.set(message.clientId,{selected,api,requestId:message.requestId,items});
    if(app.reviewerSuggestionClients.size>8)app.reviewerSuggestionClients.delete(app.reviewerSuggestionClients.keys().next().value);return {...result,items};
  } catch(error) {
    if(controller.signal.aborted||app.selected!==selected||app.api!==api)return;
    app.reviewerSuggestionClients.delete(message.clientId);return {...result,error:error.message};
  } finally {if(app.reviewerRequests.get(message.clientId)===controller)app.reviewerRequests.delete(message.clientId);}
}
async function refreshReviewers(app, selected, api) {
  const change=await api.detail(selected.id);owned(app,selected,api);
  if(change.current_revision!==selected.rev)return app.load(selected.id);
  for(const key of ['reviewers','labels','permitted_labels','submittable','updated','actions']){selected.change[key]=change[key];app.model.detail[key]=change[key];}
  const update = rows => (rows || []).map(row=>row.id===change.id?{...row,labels:change.labels,submittable:change.submittable,updated:change.updated,reviewed:!!change.reviewed}:row);
  app.model.changes=update(app.model.changes);
  for(const page of app.inboxPages?.values() || [])page.rows=update(page.rows);
  if(app.searchResults)app.searchResults.rows=update(app.searchResults.rows);
  app.send({type:'reviewersState',id:selected.id,rev:selected.rev,reviewers:change.reviewers,labels:change.labels,permitted_labels:change.permitted_labels,changeSummary:{submittable:change.submittable,updated:change.updated,actions:change.actions}});
}
async function addReviewer(app,message) {
  const {selected,api}=owned(app), cache=app.reviewerSuggestionClients?.get(message.clientId);
  if(!cache||cache.api!==api||cache.selected!==selected||cache.requestId!==message.requestId||!Number.isSafeInteger(message.index)||!cache.items[message.index])throw new Error(tr('候选人员已更新，请重新搜索选择'));
  const choice=cache.items[message.index];
  let result=await api.addReviewer(selected.id,choice.id,!!choice.confirm);
  if(result?.confirm&&!choice.confirm){owned(app,selected,api);result=await api.addReviewer(selected.id,choice.id,true);}
  if(result?.error||result?.confirm)throw new Error(result.error||tr('服务器未确认添加评审人员'));
  owned(app,selected,api);await refreshReviewers(app,selected,api);
}
async function removeReviewer(app,message) {
  const {selected,api}=owned(app), id=Number(message.accountId);
  if(!Number.isSafeInteger(id)||id<=0)throw new Error(tr('评审人员已更新，请刷新'));
  const reviewers=await api.reviewers(selected.id);owned(app,selected,api);
  if(!reviewers.some(person=>person._account_id===id))throw new Error(tr('评审人员已更新，请刷新'));
  await api.removeReviewer(selected.id,id);owned(app,selected,api);await refreshReviewers(app,selected,api);
}
module.exports={suggestReviewers,addReviewer,removeReviewer};
