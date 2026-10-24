'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
async function run() {
  try {
    const extension = vscode.extensions.getExtension('local-tools.gerrit-workbench');
    assert.ok(extension, 'Development extension must be discovered');
    const icon = fs.readFileSync(require('node:path').join(extension.extensionPath, extension.packageJSON.icon));
    assert.equal(icon.subarray(1,4).toString(), 'PNG'); assert.equal(icon.readUInt32BE(16),256); assert.equal(icon.readUInt32BE(20),256);
    await extension.activate();
    assert.equal(extension.isActive, true, 'Extension must activate with the real VS Code API');
    assert.ok(extension.packageJSON.contributes.views.gerritWorkbench, 'Workbench must use its own view container');
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('workbench.view.extension.gerrit'), 'Legacy Gerrit container fixture must be present');
    assert.ok(commands.includes('workbench.view.extension.gerritWorkbench'), 'Our container must remain separate');
    assert.equal(extension.packageJSON.contributes.configuration.properties['gerrit.comments.expandThreads'].default,true);
    for (const key of ['commitInfo.defaultExpanded','relationChain.defaultExpanded']) assert.ok(!extension.packageJSON.contributes.configuration.properties['gerrit.'+key]);
    assert.ok(['Gerrit 对比差异','Gerrit Comparison'].includes(extension.packageJSON.contributes.viewsContainers.panel[0].title));
    for (const id of ['gerrit.connect', 'gerrit.refresh', 'gerrit.logs', 'gerrit.comment', 'gerrit.fileComments', 'gerrit.tasks', 'gerrit.openLeftFile', 'gerrit.openRightFile', 'gerrit.openThisFile']) assert.ok(commands.includes(id), `${id} must be registered`);
    await vscode.commands.executeCommand('workbench.view.extension.gerritWorkbench');
    await vscode.commands.executeCommand('gerrit.dashboard.focus');
    const deadline = Date.now() + 20000;
    let health;
    do {
      health = await vscode.commands.executeCommand('gerrit._viewStatus');
      if (health.error) throw new Error(health.error);
      if (health.ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(health?.ready, 'Sidebar client script must execute and render content');


    assert.ok(extension.packageJSON.contributes.viewsContainers.panel.some(container => container.id === 'gerritChanges'), 'Files must default to the bottom Panel');
    await vscode.commands.executeCommand('gerrit.showFiles');
    const filesDeadline = Date.now() + 20000;
    do {
      health = await vscode.commands.executeCommand('gerrit._viewStatus');
      if (health.filesError) throw new Error(health.filesError);
      if (health.filesReady) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < filesDeadline);
    assert.ok(health?.filesReady, 'Bottom files Webview must execute and render');

    // Render a representative review with the shipped script inside a real Webview.
    const fixture = {
      connected: true, surface: 'discussion', panelExpansion: {sidebar:{commit:true,relation:false},discussion:{commit:true,relation:false}}, resultNavigation: { previous: true, next: true, index: 2, total: 3 }, user: 'Reviewer', server: 'https://review.example.invalid',
      detail: { id: 'fixture', _number: 142, subject: 'Improve boot device initialization', status: 'NEW', project: 'team/firmware', branch: 'main',
        owner: { name: 'Alex' }, current_revision: 'a'.repeat(40), change_id: 'Ifixture',
        created: '2026-10-20 01:02:03', updated: '2026-10-21 07:08:09',
        revisions: { ['a'.repeat(40)]: { _number: 3, previousPatch: {number:2,unchanged:true}, files: {'Boot/Device.c':{},'Library/Init.c':{}}, commit: { message: 'Improve boot device initialization\n\nKeep initialization deterministic.', author: { name: 'Alex', email: 'alex@example.invalid' }, committer: { name: 'Alex' }, parents: [{ commit: 'b'.repeat(40) }] } }, ['e'.repeat(40)]: { _number: 2, files: {'/COMMIT_MSG':{}} } },
        parentTargets: { ['b'.repeat(40)]: { status: 'found', changes: [{ id: 'parent-fixture', number: 141, patch: 1 }] } },
        labels: { 'Code-Review': { all: [{ name: 'Sam', value: 1 }, { name: 'Waiting', value: 0 }] } }, permitted_labels: { 'Code-Review': ['-1', ' 0', '+1'] },
        comparison: { left: 'base', right: 'a'.repeat(40), revision: 'a'.repeat(40) },
        related: { rev: 'a'.repeat(40), changes: [{ _change_number: 141, _revision_number: 1, _current_revision_number: 2, status: 'NEW', commit: { commit: 'b'.repeat(40), subject: 'Dependency', parents: [] } }] },
        patchView: { rev: 'a'.repeat(40), files: ['Boot/Device.c'] }, files: { 'Boot/Device.c': { lines_inserted: 12, lines_deleted: 3 }, 'Library/Init.c': { lines_inserted: 3 }, 'Large/Image.bin': { size: 30 * 1024 * 1024, blockedReason: '文件内容编码后的响应超过 32MB 限制' } },
        comments: { '/PATCHSET_LEVEL': [{id:'global',patch_set:3,author:{name:'Sam'},message:'Whole change comment'}], 'Boot/Device.c': [{ id: 'root', patch_set: 3, line: 42, updated: '2026-10-21 06:30:01', unresolved: true, author: { name: 'Sam' }, message: '**Could we check** the device state before initializing?\nSecond line of discussion' }] }, messages: [{ author: { name: 'Sam' }, _revision_number: 3, message: 'Activity first line\nActivity second line' }]
      }
    };
    const panel = vscode.window.createWebviewPanel('gerrit.smoke.review', 'Review UI smoke', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [extension.extensionUri] });
    const nonce = require('node:crypto').randomBytes(16).toString('hex');
    const media = name => panel.webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'media', name));
    let reviewAction, reviewerAddAction, reviewerRemoveAction, fileAction, searchAction, patchAction, cancelAction, compareAction, navigationAction, metadataAction, relatedAction, parentAction, childAction, patchSearchAction, singleAction, openLinkAction, comparisonReturnAction, readAction, ancestorAction, taskCancelAction, taskRetryAction, updatesAction;
    const reviewResult = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Review Webview fixture did not render')), 15000);
      panel.webview.onDidReceiveMessage(message => {
        if(message.type==='review')reviewAction=message;
        if(message.type==='reviewerAdd')reviewerAddAction=message;
        if(message.type==='reviewerRemove')reviewerRemoveAction=message;
        if(message.type==='reviewerSuggest')panel.webview.postMessage({type:'reviewerSuggestions',id:message.id,rev:message.rev,requestId:message.requestId,clientId:message.clientId,items:[{id:'9',kind:'account',name:'Suggested dev'}]});
        if (message.type === 'returnDiscussion') comparisonReturnAction = message;
        if (message.type === 'openLink') openLinkAction = message;
        if (message.type === 'fileRead') readAction = message;
        if (message.type === 'returnAncestor') ancestorAction = message;
        if (message.type === 'taskCancel') taskCancelAction = message;
        if (message.type === 'taskRetry') taskRetryAction = message;
        if (message.type === 'applySearchUpdates') updatesAction = message;
        if (message.type === 'file') fileAction = message;
        if (message.type === 'search') searchAction = message;
        if (message.type === 'patch') patchAction = message;
        if (message.type === 'compare') compareAction = message;
        if (message.type === 'navigate') navigationAction = message;
        if (message.type === 'metadata') metadataAction = message;
        if (message.type === 'related') relatedAction = message;
        if (message.type === 'parentOpen') parentAction = message;
        if (message.type === 'returnChild') childAction = message;
        if (message.type === 'patchSearch') patchSearchAction = message;
        if (message.type === 'single') singleAction = message;
        if (message.type === 'cancelSearch') cancelAction = message;
        if (message.type === 'smokeResult') { clearTimeout(timeout); message.ok ? resolve() : reject(new Error(message.error)); }
        if (message.type === 'clientError') { clearTimeout(timeout); reject(new Error(message.message)); }
      });
    });
    const fixtureScript = `
      (async () => { try {
        const initialModel=${JSON.stringify(fixture)};
        window.dispatchEvent(new MessageEvent('message', {data:{type:'state',model:initialModel}}));
        if (!document.querySelector('.discussion-layout') || !document.querySelector('#review') || !document.querySelector('.thread')) throw new Error('Review sections missing');

        if(document.querySelector('select[data-label]'))throw new Error('Scoring still uses dropdowns');
        const score=document.querySelector('[data-action="score"][data-value="1"]');score.click();
        if(score.getAttribute('aria-pressed')!=='true'||score.getBoundingClientRect().width>80)throw new Error('Direct score choice failed');
        document.getElementById('review').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        const own={...initialModel,detail:{...initialModel.detail,mine:true,reviewers:{REVIEWER:[{_account_id:8,name:'Existing reviewer'}]},editStatus:{edit:{commit:{commit:'draft'},base_revision:initialModel.detail.current_revision}}}};
        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:own}}));
        if(!document.querySelector('[data-action="rebase"]')||!document.querySelector('[data-action="discardEdit"]'))throw new Error('Rebase or discard not discoverable');
        const reviewerInput=document.getElementById('reviewer-query');reviewerInput.value='dev';reviewerInput.dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,250));
        const pick=document.querySelector('[data-action="reviewerPick"]');if(!pick||!pick.textContent.includes('Suggested dev'))throw new Error('Inline reviewer suggestion missing');pick.click();
        document.querySelector('[data-action="reviewerRemove"]').click();
        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:initialModel}}));

        if (document.getElementById('app').textContent.includes('提交时间')) throw new Error('Obsolete timestamp');
        const thread = document.querySelector('.thread:has([data-action="locate"])');
        const global=[...document.querySelectorAll('.thread')].find(item=>item.textContent.includes('Whole change comment'));
        if (!global || global.querySelector('[data-action="locate"]')) throw new Error('Global comment exposes code navigation');
        if (!thread.querySelector('.markdown-body strong')) throw new Error('Markdown not rendered');
        thread.open = false;
        if (!thread.querySelector('.thread-snippet').textContent.includes('Could we check') || thread.getBoundingClientRect().height > 55) throw new Error('Collapsed discussion is not one line');
        await new Promise(resolve=>setTimeout(resolve,180));
        const threadClosed = getComputedStyle(thread.querySelector('summary'),'::before').transform;
        thread.open = true;
        await new Promise(resolve=>setTimeout(resolve,180));
        const threadOpen = getComputedStyle(thread.querySelector('summary'),'::before').transform;
        if (threadClosed === threadOpen) throw new Error('Thread chevron did not rotate');
        const activity = document.querySelector('.activity');
        if (!activity.querySelector('.activity-snippet').textContent.includes('Activity first line')) throw new Error('Activity first line missing');
        const activityClosed=getComputedStyle(activity.querySelector('summary'),'::before').transform;
        activity.open=true; await new Promise(resolve=>setTimeout(resolve,180));
        if (getComputedStyle(activity.querySelector('summary'),'::before').transform===activityClosed) throw new Error('Activity chevron did not rotate');
        document.querySelector('[data-action="navigate"][data-direction="1"]').click();
        if (parseFloat(getComputedStyle(document.body).paddingTop) > 12) throw new Error('Discussion chrome is not compact');
        const replyPreview = thread.querySelector('.markdown-preview'); replyPreview.click();
        const replyInput = thread.querySelector('textarea');
        if (replyInput.hidden) throw new Error('Reply editor did not open');
        replyInput.value='**Reply preview**'; replyInput.dispatchEvent(new Event('input',{bubbles:true}));
        replyInput.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
        if (!replyInput.hidden || !replyPreview.querySelector('strong')) throw new Error('Reply blur preview failed');

        if (document.querySelector('.unscored').open || !document.querySelector('.unscored').textContent.includes('Waiting')) throw new Error('Unscored reviewers are not folded');
        if(innerWidth>650 && getComputedStyle(document.querySelector('.review-float')).position!=='sticky')throw new Error('Review pane does not follow scrolling');
        const ratings = document.querySelector('.ratings'); const composer = document.querySelector('.composer');
        if (getComputedStyle(composer).position !== 'static' || composer.getBoundingClientRect().bottom > ratings.getBoundingClientRect().top) throw new Error('Composer overlaps current votes');
        window.scrollTo(0, document.body.scrollHeight);
        if (composer.getBoundingClientRect().bottom > ratings.getBoundingClientRect().top) throw new Error('Scrolling overlaps current votes');
        if (!document.querySelector('.chain-node') || !document.getElementById('app').textContent.includes('旧 PS')) throw new Error('Relation chain missing');

        document.querySelector('[data-action="tabCode"]').click();
        window.dispatchEvent(new MessageEvent('message',{data:{type:'showDiscussion'}}));
        if (document.querySelector('#patch-browser')) throw new Error('Returning to discussion kept the code tab open');
        document.querySelector('[data-action="tabCode"]').click();
        if (document.querySelector('#compare')) throw new Error('Discussion must not have comparison controls');
        if (!document.getElementById('patch-revision').textContent.includes('与 PS 2 无代码差异')) throw new Error('Empty Patch label missing');
        if (!document.querySelector('[data-action="single"]') || !document.querySelector('[data-action="download"]')) throw new Error('Patch tools missing');
        if (!document.getElementById('patch-search').textContent.includes('查找此版本中的文件')) throw new Error('File lookup label unclear');
        document.getElementById('patch-search-text').value='unmodified.h';
        document.getElementById('patch-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        window.dispatchEvent(new MessageEvent('message',{data:{type:'patchView',id:'fixture',currentRevision:'a'.repeat(40),patchView:{rev:'a'.repeat(40),query:'unmodified.h',files:['Include/Unmodified.h']}}}));
        document.querySelector('[data-action="single"]').click();
        if (document.getElementById('app').textContent.includes('浏览此 Patch')) throw new Error('Obsolete Patch browse button');
        document.getElementById('patch-revision').dispatchEvent(new Event('change', {bubbles:true}));
        document.querySelector('[data-action="tabDiscussion"]').click();
        document.querySelector('#review .markdown-preview').click();
        const input = document.getElementById('review-message'); input.value='Unsent draft'; input.dispatchEvent(new Event('input',{bubbles:true}));
        window.dispatchEvent(new MessageEvent('message',{data:{type:'downloadState',downloads:[]}}));
        window.dispatchEvent(new MessageEvent('message',{data:{type:'tasks',tasks:[{id:'working',title:'Index',status:'running',cancelable:true}]}}));
        window.dispatchEvent(new MessageEvent('message',{data:{type:'inboxResults',changes:[],navigation:{previous:true,next:true,index:2,total:3},updates:{pending:2}}}));
        window.dispatchEvent(new MessageEvent('message',{data:{type:'patchComparisons',id:'fixture',rev:'a'.repeat(40),patches:{['a'.repeat(40)]:{number:2,unchanged:true}}}}));
        if (document.getElementById('review-message')!==input) throw new Error('Background updates replaced review editor');
        if (!document.querySelector('[data-action="applySearchUpdates"]')) throw new Error('New results banner missing in discussion');
        document.querySelector('[data-action="applySearchUpdates"]').click();
        if (document.getElementById('review-message').value!=='Unsent draft') throw new Error('Draft replaced by download update');
        window.dispatchEvent(new MessageEvent('message',{data:{type:'parentState',id:'fixture',rev:'a'.repeat(40),parentTargets:model.detail.parentTargets}}));
        if (document.getElementById('review-message')!==input) throw new Error('Parent resolution replaced active draft');
        document.querySelector('[data-action="parentOpen"]').click();

        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...model,surface:'sidebar'}}}));
        if (!document.querySelector('.timestamps').nextElementSibling.matches('.commit-info')) throw new Error('Commit ordering');
        document.querySelector('[data-action="navigate"][data-direction="-1"]').click();
        document.querySelector('[data-action="metadata"][data-kind="author"]').click();
        if (!document.querySelector('#compare') || document.querySelector('[data-action="file"]')) throw new Error('Sidebar comparison/file placement');
        if (document.querySelector('#compare button[type="submit"]')) throw new Error('Manual comparison button remains');
        if (!document.getElementById('compare-right').textContent.includes('与 PS 2 无代码差异')) throw new Error('Empty comparison Patch label missing');
        const leftVersion=document.getElementById('compare-left'), rightVersion=document.getElementById('compare-right');
        if ([...leftVersion.options].some(option=>option.value===rightVersion.value) || [...rightVersion.options].some(option=>option.value===leftVersion.value)) throw new Error('Duplicate Patch selection allowed');
        leftVersion.dispatchEvent(new Event('change',{bubbles:true}));
        if (document.querySelector('.review-entry').getBoundingClientRect().height > 95) throw new Error('Review entry still too large');
        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...model,detail:{...model.detail,related:undefined}}}}));
        const relation=document.getElementById('relation-chain');
        if (!relation || relation.tagName!=='DETAILS' || relation.open) throw new Error('Relation must start as a collapsed panel');
        relation.open=true; relation.dispatchEvent(new Event('toggle'));
        window.dispatchEvent(new MessageEvent('message',{data:{type:'relatedState',id:'fixture',rev:'a'.repeat(40),related:{changes:[]}}}));
        if (!document.getElementById('relation-chain').open) throw new Error('Relation collapsed while loading');
        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...model,surface:'files'}}}));
        if (getComputedStyle(document.querySelector('.file-row')).borderTopColor !== 'rgba(0, 0, 0, 0)') throw new Error('File rows should not have box outlines');
        if (document.querySelector('.file-row').getBoundingClientRect().height > 30) throw new Error('File rows are not compact');
        window.dispatchEvent(new MessageEvent('message',{data:{type:'fileProgress',id:'fixture',revision:'a'.repeat(40),progress:{revision:'a'.repeat(40),number:3,read:['Library/Init.c'],changed:['Boot/Device.c'],baselineNumber:2,baselineRevision:'b'.repeat(40)}}}));
        if (!document.getElementById('app').textContent.includes('版本有变化')) throw new Error('Changed file indication missing');
        const read=document.querySelector('input[data-read-file="Boot/Device.c"]');
        read.checked=true; read.dispatchEvent(new Event('change',{bubbles:true}));
        const oversized=document.querySelector('[data-action="file"][data-path="Large/Image.bin"]');
        if (Math.abs(oversized.querySelector('.file-name').getBoundingClientRect().top-oversized.querySelector('.file-limit').getBoundingClientRect().top)>2) throw new Error('Limit warning wraps onto a new line');
        if (!oversized?.disabled || getComputedStyle(oversized).cursor!=='not-allowed') throw new Error('Oversized file is selectable');
        document.querySelector('[data-action="returnDiscussion"]').click();
        const filter=document.getElementById('file-filter');
        filter.value='Device'; filter.dispatchEvent(new Event('input',{bubbles:true}));
        if (document.querySelectorAll('.file-row').length!==1) throw new Error('File path filtering');
        document.querySelector('.file-row').click();


        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...model,detail:undefined,surface:'sidebar',query:'is:open'}}}));
        const lefts=['message-filter','changeNumber-filter','file-filter-search','repo-filter','branch-filter','owner-filter'].map(id=>document.getElementById(id).getBoundingClientRect().left);
        if (Math.max(...lefts)-Math.min(...lefts)>1) throw new Error('Search fields do not align');
        for (const [name, value] of Object.entries({message:'test',repo:'team/firmware',branch:'main',owner:'self',changeNumber:'322',file:'Device.C'})) {
          const input=document.getElementById(name==='file'?'file-filter-search':name+'-filter'); if(!input) throw new Error('Missing search field '+name); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));
        }
        if (!document.querySelector('[data-query="is:abandoned"]') || document.getElementById('app').textContent.includes('待我评审')) throw new Error('Inbox presets incorrect');
        document.getElementById('search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        const searchInput = document.getElementById('message-filter');
        window.dispatchEvent(new MessageEvent('message',{data:{type:'inboxResults',changes:[{id:'hit',subject:'Streaming test',status:'NEW',work_in_progress:true,owner:{name:'Sam'},project:'team/firmware',branch:'main',updated:'2026-10-21 06:30:00'}],start:0,more:false}}));
        if (document.getElementById('message-filter') !== searchInput || searchInput.value !== 'test') throw new Error('Search form replaced by incremental result');
        const card = document.querySelector('.change');
        if (!card?.classList.contains('state-wip') || getComputedStyle(document.querySelector('[data-action="push"]')).borderTopStyle === 'none') throw new Error('Status color or button outline missing');
        if (!card || card.getBoundingClientRect().height > 125 || !card.textContent.includes('WIP')) throw new Error('Streaming card missing or not compact');
        window.dispatchEvent(new MessageEvent('message',{data:{type:'inboxResults',changes:[{id:'ready',subject:'Ready',status:'NEW',submittable:true,labels:{'Code-Review':{all:[{value:0},{value:0},{value:1}]}}}],start:0,more:false}}));
        const ready=document.querySelector('.state-ready');
        if (ready.textContent.includes('0 / 0') || !ready.textContent.includes('Code-Review +1 / 0')) throw new Error('Repeated score values');
        if (!ready || !ready.textContent.includes('可合入') || getComputedStyle(ready).borderLeftColor!=='rgb(231, 121, 180)') throw new Error('Ready card not pink');

        window.dispatchEvent(new MessageEvent('message',{data:{type:'inboxResults',changes:[{id:'wip',status:'NEW',work_in_progress:true},{id:'minus1',status:'NEW',submittable:true,labels:{'Code-Review':{all:[{value:-1}]}}},{id:'minus2',status:'NEW',labels:{'Code-Review':{all:[{value:-2}]}}}],start:0,more:false}}));
        const negatives=[...document.querySelectorAll('.state-negative')];
        if(negatives.length!==2||getComputedStyle(negatives[0]).borderLeftColor!==getComputedStyle(negatives[1]).borderLeftColor)throw new Error('Negative score colors differ');
        if(getComputedStyle(document.querySelector('.state-wip')).borderLeftColor===getComputedStyle(negatives[0]).borderLeftColor)throw new Error('WIP and negative votes share a color');
        if(!negatives[0].textContent.includes('可合入'))throw new Error('Negative votes incorrectly override server eligibility');

        window.dispatchEvent(new MessageEvent('message',{data:{type:'searchProgress',searchStatus:{status:'running',scanned:1,matches:1}}}));
        window.dispatchEvent(new MessageEvent('message',{data:{type:'busy',value:true}}));
        const stop = document.querySelector('[data-action="cancelSearch"]');
        if (stop.disabled) throw new Error('Busy state disables stop');
        stop.click();
        window.dispatchEvent(new MessageEvent('message',{data:{type:'busy',value:false}}));

        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...model, connected:true, surface:'discussion', parentNavigation:{number:142}, detail:{id:'parent-fixture',subject:'Latest parent',current_revision:'a'.repeat(40),viewRevision:'b'.repeat(40),revisions:{['a'.repeat(40)]:{_number:2,commit:{message:'Latest parent'}},['b'.repeat(40)]:{_number:1,commit:{message:'Exact parent',parents:[{commit:'f'.repeat(40)}]}}},parentTargets:{['f'.repeat(40)]:{status:'missing',changes:[]}}}}}}));
        if (document.querySelector('[data-action="navigate"]') || !document.querySelector('[data-action="returnChild"]')) throw new Error('Parent mode navigation incorrect');
        if (document.querySelector('#review') || !document.querySelector('[data-action="openLatest"]')) throw new Error('Historical review is not guarded');
        if (document.querySelector('[data-action="parentOpen"]')) throw new Error('Unrelated Git parent should not be clickable');
        if (document.querySelector('h1').textContent!=='Exact parent') throw new Error('Historical parent title incorrect');
        document.querySelector('[data-action="returnChild"]').click();
        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...model,parentNavigation:{number:142},breadcrumbs:[{index:0,number:142},{index:1,number:141}]}}}));
        document.querySelector('[data-action="returnAncestor"][data-index="0"]').click();
        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...model,surface:'tasks',backgroundTasks:[{id:'working',title:'Path index',status:'running',cancelable:true},{id:'failed',title:'Download',status:'failed',retryable:true}]}}}));
        window.dispatchEvent(new MessageEvent('message',{data:{type:'busy',value:true}}));
        for (const action of ['taskCancel','taskRetry']) { const button=document.querySelector('[data-action="'+action+'"]'); if(button.disabled) throw new Error('Busy disabled task control'); button.click(); }
        window.dispatchEvent(new MessageEvent('message',{data:{type:'busy',value:false}}));
        initialModel.detail.comments['Boot/Device.c'][0].message+=' [Docs](https://docs.example/guide)';
        for(const surface of ['sidebar','discussion','files','tasks']) {
          window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...initialModel,language:'en',surface}}}));
          if (/[\u3400-\u9fff]/.test(document.getElementById('app').textContent)) throw new Error('English UI contains Chinese: '+surface);
          if(document.documentElement.lang!=='en') throw new Error('Language metadata did not update');
        }
        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...initialModel,language:'en',surface:'discussion'}}}));
        const link=document.querySelector('.markdown-body a[href="https://docs.example/guide"]');
        if (!link || link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))) throw new Error('Comment link was not intercepted');
        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...initialModel,language:'zh-CN',surface:'discussion'}}}));
        if(!document.getElementById('app').textContent.includes('评审')) throw new Error('Chinese language was not restored');
        post('smokeResult',{ok:true});
      } catch(error) { post('smokeResult',{ok:false,error:error.stack}); } })();
    `;
    panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'"><link rel="stylesheet" href="${media('style.css')}"></head><body><header><div id="account"></div></header><div id="notice"></div><main id="app"></main><script nonce="${nonce}" src="${media('vendor/markdown-it.min.js')}"></script><script nonce="${nonce}" src="${media('i18n.js')}"></script><script nonce="${nonce}" src="${media('main.js')}"></script><script nonce="${nonce}">${fixtureScript}</script></body></html>`;
    await reviewResult;
    assert.equal(reviewAction?.labels?.['Code-Review'],1);assert.equal(reviewerAddAction?.index,0);assert.equal(reviewerRemoveAction?.accountId,'8');
    assert.equal(openLinkAction?.url,'https://docs.example/guide');
    assert.equal(navigationAction?.direction, '-1'); assert.equal(navigationAction?.id, 'fixture');
    assert.equal(metadataAction?.kind, 'author'); assert.equal(relatedAction, undefined, 'Expansion must never issue a loading request');
    assert.equal(patchSearchAction?.query, 'unmodified.h'); assert.equal(patchSearchAction?.patchRev, 'a'.repeat(40));
    assert.equal(singleAction?.path, 'Include/Unmodified.h');
    assert.equal(parentAction?.sha, 'b'.repeat(40)); assert.equal(parentAction?.id, 'fixture');
    assert.equal(childAction?.id, 'parent-fixture');
    assert.equal(fileAction?.id, 'fixture'); assert.equal(fileAction?.rev, 'a'.repeat(40));
    assert.equal(fileAction?.compareLeft, 'base'); assert.equal(fileAction?.compareRight, 'a'.repeat(40));
    assert.equal(fileAction?.path, 'Boot/Device.c');
    assert.equal(compareAction?.left, 'base'); assert.equal(compareAction?.right, 'a'.repeat(40));
    assert.equal(patchAction?.patchRev, 'a'.repeat(40)); assert.equal(cancelAction?.type, 'cancelSearch');
    assert.equal(comparisonReturnAction?.id, 'fixture');
    assert.equal(searchAction?.changeNumber, '322'); assert.equal(searchAction?.file, 'Device.C');
    assert.equal(readAction?.path, 'Boot/Device.c'); assert.equal(readAction?.fileRev, 'a'.repeat(40)); assert.equal(readAction?.read, true);
    assert.equal(ancestorAction?.index, '0'); assert.equal(taskCancelAction?.taskId, 'working'); assert.equal(taskRetryAction?.taskId, 'failed');
    assert.equal(updatesAction?.type, 'applySearchUpdates');
    assert.equal(searchAction?.message, 'test'); assert.equal(searchAction?.repo, 'team/firmware');
    assert.equal(searchAction?.branch, 'main'); assert.equal(searchAction?.owner, 'self'); panel.dispose();


    const { NativeFiles } = require(require('node:path').join(extension.extensionPath, 'src', 'native-files.js'));
    const originals = new NativeFiles(vscode);
    const excelFixture = process.env.GERRIT_EXCEL_FIXTURES;
    const oldBytes = excelFixture ? fs.readFileSync(require('node:path').join(excelFixture,'old.xlsx')) : Buffer.from([0,255,80,75,3,4,1]);
    const newBytes = excelFixture ? fs.readFileSync(require('node:path').join(excelFixture,'new.xlsx')) : Buffer.from([0,255,80,75,3,4,2]);
    await originals.openPair([
      {bytes:oldBytes,path:'workbook.xlsx',label:'PS 1'},
      {bytes:newBytes,path:'workbook.xlsx',label:'PS 2'}
    ]);
    const uris = [...originals.files.values()];
    assert.equal(uris.length,2); assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(uris[0])),oldBytes);
    assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(uris[1])),newBytes);
    const tabs = vscode.window.tabGroups.all.flatMap(group=>group.tabs.filter(tab=>uris.some(uri=>tab.input?.uri?.toString()===uri.toString())).map(tab=>({tab,column:group.viewColumn})));
    assert.ok(tabs.every(item=>item.tab.isPreview), 'Binary comparisons should use preview tabs');
    assert.equal(tabs.length,2); assert.notEqual(tabs[0].column,tabs[1].column,'Originals must open in two native groups');
    if (excelFixture) {
      const viewer = vscode.extensions.getExtension(process.env.GERRIT_EXCEL_VIEWER);
      assert.ok(viewer?.isActive, 'The third-party viewer must activate');
      for (const {tab} of tabs) assert.ok(tab.input instanceof vscode.TabInputCustom, 'XLSX must open in a real custom editor, not a binary text tab');
      console.log('Excel custom editors: ' + tabs.map(({tab})=>tab.input.viewType).join(', '));
      if (Number(process.env.GERRIT_EXCEL_HOLD)) await new Promise(resolve=>setTimeout(resolve, Number(process.env.GERRIT_EXCEL_HOLD)*1000));
    }
    await vscode.window.tabGroups.close(tabs.map(item=>item.tab));
    await originals.dispose();

    // Exercise the actual command-selection path used by the native Comments panel,
    // not the discussion Webview's locate button.
    const {nativeCommentTarget} = require(require('node:path').join(extension.extensionPath, 'src', 'comment-navigation.js'));
    const navScheme = 'gerrit-native-comment-smoke';
    const navProvider = vscode.workspace.registerTextDocumentContentProvider(navScheme, {provideTextDocumentContent: () => 'one\ntwo\nthree\nfour\nfive\n'});
    const navUri = vscode.Uri.parse(navScheme + ':/review.c'), baseUri = vscode.Uri.parse(navScheme + ':/base.c');
    const navController = vscode.comments.createCommentController('gerrit.nativeNavigationSmoke', 'Gerrit navigation smoke');
    navController.options = {prompt:'Add a comment or reply…',placeHolder:'Write a comment; click Post to publish'};
    const navRange = new vscode.Range(2,0,2,0);
    const navThread = navController.createCommentThread(navUri, navRange, [{body:'Native navigation test',author:{name:'Reviewer'},mode:vscode.CommentMode.Preview}]);
    const navThreads = new Map([[navThread,{path:'review.c',commentIds:['root']}]]);
    let resolveNavigation, rejectNavigation, navigationError;
    const nativeNavigation = new Promise((resolve,reject)=>{resolveNavigation=resolve;rejectNavigation=reject;});
    const navTimeout = setTimeout(()=>rejectNavigation(new Error('Native Comments selection was not redirected: '+JSON.stringify(navigationError))),5000);
    const navListener = vscode.window.onDidChangeTextEditorSelection(event => {
      if(event.textEditor.document.uri.toString()===navUri.toString()) navigationError={kind:event.kind,line:event.selections[0].start.line,tab:vscode.window.tabGroups.activeTabGroup.activeTab?.input?.constructor.name};
      const target = nativeCommentTarget(vscode,event,navThreads); if(!target) return;
      clearTimeout(navTimeout);
      vscode.commands.executeCommand('vscode.diff',baseUri,navUri,'Native comment diff',{preview:true}).then(resolveNavigation,rejectNavigation);
    });
    try {
      await vscode.commands.executeCommand('vscode.open',navUri,{preview:true,selection:navRange});
      await nativeNavigation;
      const navTab=vscode.window.tabGroups.activeTabGroup.activeTab;
      assert.ok(navTab?.input instanceof vscode.TabInputTextDiff,'Native comment navigation must finish in a diff');
      assert.equal(navTab.input.modified.toString(),navUri.toString());
      assert.equal(navController.options.prompt,'Add a comment or reply…');
    } finally {
      clearTimeout(navTimeout);navListener.dispose();navController.dispose();
      const navTabs=vscode.window.tabGroups.all.flatMap(group=>group.tabs.filter(tab=>tab.input?.uri?.scheme===navScheme||tab.input?.modified?.scheme===navScheme));
      await vscode.window.tabGroups.close(navTabs);navProvider.dispose();
    }

    await require('./edit-host-smoke').run(extension);
    await vscode.commands.executeCommand('gerrit.logs');
    fs.writeFileSync(process.env.GERRIT_HOST_SMOKE_RESULT, JSON.stringify({ ok: true, vscode: vscode.version, extension: extension.packageJSON.version, excel: process.env.GERRIT_EXCEL_VIEWER ? 'valid old/new XLSX opened in custom editors in two preview groups' : undefined }));
    console.log('Real Extension Host activation and sidebar smoke test passed');
  } catch (error) {
    fs.writeFileSync(process.env.GERRIT_HOST_SMOKE_RESULT, JSON.stringify({ ok: false, message: error.stack || error.message }));
    throw error;
  }
}
module.exports = { run };
