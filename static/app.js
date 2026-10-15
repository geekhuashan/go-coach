const $ = id => document.getElementById(id);
let activeView='board';
let teachingPlayback=null,teachingPlaybackEpoch=0,teachingPlaybackRequest=null;
function showView(view,{focus=false}={}){
 if(!['board','library','records','settings'].includes(view))view='board';
 closeDrawers();
 activeView=view;
 document.querySelectorAll('.app-view').forEach(el=>el.hidden=el.id!=='view-'+view);
 document.querySelectorAll('.page-nav button').forEach(el=>{if(el.dataset.openView===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current')});
 if(focus){if(view==='board')document.querySelector('.board-controls').scrollTop=0;const target=view==='board'?$('board-title'):$('view-'+view).querySelector('h2');target.setAttribute('tabindex','-1');target.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
}
document.querySelectorAll('[data-open-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.openView,{focus:true})));
function closeDrawers(){stopTeachingPlayback();[...document.querySelectorAll('.app-drawer[open]')].reverse().forEach(dialog=>dialog.close());}
function openDrawer(id){closeDrawers();$(id).showModal();document.body.classList.add('drawer-open');}
$('open-menu').onclick=()=>openDrawer('menu-drawer');
$('open-coach').onclick=()=>{if($('open-coach').dataset.aiReady==='true')$('explain-panel').open=true;openDrawer('coach-drawer');};
document.querySelectorAll('[data-close-dialog]').forEach(button=>button.onclick=()=>{if(button.dataset.closeDialog==='video-player-dialog')stopTeachingPlayback();$(button.dataset.closeDialog).close();});
document.querySelectorAll('.app-drawer').forEach(dialog=>{
 dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
 dialog.addEventListener('close',()=>{if(dialog.contains($('toast'))){$('toast').hidden=true;document.body.append($('toast'));}document.body.classList.toggle('drawer-open',!!document.querySelector('.app-drawer[open]'));});
 dialog.addEventListener('toggle',()=>document.body.classList.toggle('drawer-open',!!document.querySelector('.app-drawer[open]')));
});
const cols = 'ABCDEFGHJKLMNOPQRST';
let boardZoom=false, pendingMove=null, selectedPoints=[], selectedAnswer=null;
let boardRenderKey=null;
let cloudMode=false,authenticated=false,authEpoch=0,pollTimer=null,installPrompt=null,connectionFailures=0;
let sessionRequest=null,sessionRetryTimer=null,sessionRetryAttempt=0;
const confirmDefault=false;
let state = null, lessons = [], inspection = null, busy = false, toastTimer;
let chapterDirectoryCache=null,chapterNavigationOpen=false,chapterNavigationKey=null,chapterGridItems=null;
let busyAction=null,actionRequest=null,refreshRequest=null;
let syncRequest=null,syncSupported=null,syncFailures=0,syncRetryAt=0,catalogRevision=null,catalogRequest=null;
let writeRecovery=null,writeRecoveryRequest=null;
let patternReturn=null,patternWorker=null,patternReviewEpoch=0;
let pendingInspectionHelp=readPendingInspectionHelp();
let selectedMode='lesson', selectionPending=false, aiAttemptKey=null, aiFailedKey=null;
let llmSettings={enabled:false},llmBusy=false,llmAutoSeen=new Set(),llmResult=null,llmError=null,llmSettingsBusy=false;
let llmRequest=null,llmAutoTimer=null;
const svgNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs={}, text='') { const el=document.createElementNS(svgNS,tag); Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v)); if(text)el.textContent=text;return el; }
function toast(text){([...document.querySelectorAll('.app-drawer[open]')].at(-1)||document.body).append($('toast'));$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4200)}
function connected(online,{force=false}={}){if(online)connectionFailures=0;else connectionFailures++;const interrupted=!online&&(force||!navigator.onLine||connectionFailures>=2);$('connection').className='connection '+(online?'online':interrupted?'offline':'reconnecting');$('connection').replaceChildren(Object.assign(document.createElement('i'),{}),document.createTextNode(online?(cloudMode?'家庭棋盘已连接':'本地棋盘已连接'):interrupted?'当前离线或连接中断':'网络波动，正在重连'));}
function transientError(message,kind){const error=new Error(message);error.transient=true;error.kind=kind;return error}
async function timedFetch(url,options={},timeoutMs=12000,consume=null){
 const controller=new AbortController(),caller=options.signal,abort=()=>controller.abort(),timer=setTimeout(abort,timeoutMs);
 if(caller?.aborted)abort();else caller?.addEventListener('abort',abort,{once:true});
 try{const response=await fetch(url,{...options,signal:controller.signal});return consume?await consume(response):response;}
 catch(error){if(caller?.aborted){const cancelled=new Error('已停止等待上一局面的请求。');cancelled.cancelled=true;throw cancelled;}if(error.transient||error.status)throw error;throw transientError(controller.signal.aborted?'连接等待超时，正在同步最新棋盘。':'网络暂时波动，正在重新连接。',controller.signal.aborted?'timeout':'network')}
 finally{clearTimeout(timer);caller?.removeEventListener('abort',abort)}
}
async function request(url, options={}){
 let {timeoutMs,handleConflict=true,retryRead=true,...requestOptions}=options;
 if(requestOptions.method==='POST'&&requestOptions.body&&state?.profile?.id){const payload=JSON.parse(requestOptions.body);if(!payload.expected_profile_id)payload.expected_profile_id=state.profile.id;requestOptions={...requestOptions,body:JSON.stringify(payload)};}
 const epoch=authEpoch,check=()=>{if(requestOptions.signal?.aborted){const e=new Error('已停止等待上一局面的请求。');e.cancelled=true;throw e;}if(epoch!==authEpoch)throw Object.assign(new Error('登录状态已改变，请重试。'),{status:401});};
 const tries=retryRead&&(!requestOptions.method||requestOptions.method==='GET')?2:1;
 for(let attempt=0;attempt<tries;attempt++){
  try{
   const {response,result}=await timedFetch(url,{cache:'no-store',...requestOptions,headers:{'Content-Type':'application/json',...requestOptions.headers}},timeoutMs||(requestOptions.method==='POST'?20000:12000),async response=>{
    check();if(response.status===401){lockSession();throw Object.assign(new Error('请重新输入家庭密码。'),{status:401});}
    let result;try{result=await response.json()}catch{check();throw transientError(response.status>=500?'服务暂时繁忙，正在同步最新棋盘。':'服务响应暂时不完整，正在重新连接。','response');}
    check();return {response,result};
   });
   check();
   if(!response.ok){
    if(response.status===409){const e=Object.assign(new Error('棋盘已经更新，请看一下当前局面再试。'),{status:409,state:result?.state});if(handleConflict)await refresh();check();throw e;}
    const error=Object.assign(new Error(result?.error||result?.message||'暂时没有完成，请再试一次。'),{status:response.status,transient:response.status>=500});throw error;
   }
   if((url==='/api/state'||url==='/api/action')&&(!result||!Number.isInteger(result.revision)||!Array.isArray(result.board)||!result.profile?.id))throw transientError('棋盘响应不完整，正在同步最新棋盘。','response');
   connected(true);return result;
  }catch(error){check();if(!error.transient||attempt===tries-1)throw error;}
 }
}
async function refresh(){
 if(!authenticated||!navigator.onLine)return false;
 if(refreshRequest?.epoch===authEpoch)return refreshRequest;
 const initialState=state,epoch=authEpoch,recovery=writeRecovery;
 const pending=(async()=>{
  let next;try{next=await request('/api/state',{timeoutMs:10000})}catch(error){if(!error.cancelled&&epoch===authEpoch&&error.transient)connected(false);return false}
  if(epoch!==authEpoch||state!==initialState)return true;
  try{if(refresh.renderPending||!state||next.revision!==state.revision||next.profile?.id!==state.profile?.id||JSON.stringify(next.engine)!==JSON.stringify(state.engine)||JSON.stringify(next.llm_explanation)!==JSON.stringify(state.llm_explanation)||JSON.stringify(next.sync)!==JSON.stringify(state.sync)||next.assisted!==state.assisted)setState(next);refresh.renderPending=false;if(recovery&&writeRecovery===recovery)writeRecovery=null;return true}
  catch(error){reportRenderError();return false}
 })();
 pending.epoch=epoch;refreshRequest=pending;try{return await pending;}finally{if(refreshRequest===pending)refreshRequest=null;}
}
async function reloadLessonCatalog(version=null){
 if(catalogRequest?.epoch===authEpoch)return catalogRequest;
 const epoch=authEpoch,pending=(async()=>{
  const data=await request('/api/lessons',{retryRead:false});
  if(epoch!==authEpoch||!authenticated)return false;
  const items=Array.isArray(data)?data:data?.lessons;
  if(!Array.isArray(items))throw transientError('练习目录暂时未载入，稍后会自动重试。','response');
  lessons=items;catalogRevision=version;renderSkillPicker();if(state)render();return true;
 })();
 pending.epoch=epoch;catalogRequest=pending;try{return await pending;}finally{if(catalogRequest===pending)catalogRequest=null;}
}
async function reconcilePendingWrite(){
 if(!writeRecovery)return true;
 if(writeRecoveryRequest?.epoch===authEpoch)return writeRecoveryRequest;
 const epoch=authEpoch,marker=writeRecovery,earlierRead=refreshRequest;
 const pending=(async()=>{
  await refresh();
  // A read begun before the failed write cannot establish whether it committed.
  if(epoch===authEpoch&&earlierRead&&writeRecovery===marker)await refresh();
  return epoch===authEpoch&&authenticated&&!writeRecovery;
 })();
 pending.epoch=epoch;writeRecoveryRequest=pending;try{return await pending;}finally{if(writeRecoveryRequest===pending)writeRecoveryRequest=null;}
}
async function lightSync(){
 if(!authenticated||!navigator.onLine||document.hidden||busy)return false;
 if(syncRequest?.epoch===authEpoch)return syncRequest;
 if(Date.now()<syncRetryAt)return false;
 const epoch=authEpoch,initialState=state;
 const pending=(async()=>{
  try{
   let ok;
   if(writeRecovery)ok=await reconcilePendingWrite();
   else if(!state||!cloudMode||syncSupported===false){ok=await refresh();if(ok&&!lessons.length)await reloadLessonCatalog(state?.sync?.catalog_revision??null);}
   else{
    let probe;
    try{probe=await request('/api/sync',{timeoutMs:10000,retryRead:false});}
    catch(error){if(error.status!==404)throw error;syncSupported=false;ok=await refresh();if(ok&&!lessons.length)await reloadLessonCatalog(null);}
    if(probe){
     if(!Number.isInteger(probe.revision)||typeof probe.profile_id!=='string'||typeof probe.requires_refresh!=='boolean'||!(probe.catalog_revision===null||typeof probe.catalog_revision==='string')||!(probe.explanation_revision===null||typeof probe.explanation_revision==='string'))throw transientError('同步响应暂时不完整，稍后重试。','response');
     if(epoch!==authEpoch||!authenticated||busy||state!==initialState)return false;
     syncSupported=true;
     const baseline=state.sync,catalogChanged=probe.catalog_revision!==catalogRevision;
     const changed=probe.requires_refresh||!baseline||probe.revision!==state.revision||probe.profile_id!==state.profile?.id||probe.explanation_revision!==baseline.explanation_revision||probe.catalog_revision!==baseline.catalog_revision||refresh.renderPending;
     if(catalogChanged||!lessons.length)await reloadLessonCatalog(probe.catalog_revision);
     if(epoch!==authEpoch||!authenticated)return false;
     ok=changed||catalogChanged?await refresh():true;
    }
   }
   if(epoch!==authEpoch)return false;
   if(ok){syncFailures=0;syncRetryAt=0;return true;}
   throw transientError('暂时无法同步，稍后重试。','network');
  }catch(error){
   if(epoch!==authEpoch||error.cancelled)return false;
   syncFailures++;syncRetryAt=Date.now()+Math.min(60000,12000*2**Math.min(syncFailures-1,3));
   if(error.transient)connected(false);return false;
  }
 })();
 pending.epoch=epoch;syncRequest=pending;try{return await pending;}finally{if(syncRequest===pending)syncRequest=null;}
}
function clearPrivateUI(){globalThis.GoGrowth?.clear();refreshRequest=null;syncRequest=null;syncSupported=null;syncFailures=0;syncRetryAt=0;catalogRevision=null;catalogRequest=null;writeRecovery=null;writeRecoveryRequest=null;document.body.removeAttribute('aria-busy');patternReviewEpoch++;patternWorker?.terminate();patternWorker=null;patternReturn=null;window.GoMatchPatterns?.close();if(actionRequest){actionRequest.controller.abort();actionRequest=null;}busy=false;busyAction=null;cancelExplanation();$('lesson-videos').querySelector('summary').textContent='中文视频讲解';closeDrawers();document.body.classList.remove('session-ready','drawer-open');showView('board');document.querySelectorAll('.compact-disclosure').forEach(el=>el.open=false);state=null;lessons=[];chapterDirectoryCache=null;chapterNavigationOpen=false;chapterNavigationKey=null;chapterGridItems=null;$('chapter-navigation').hidden=true;$('chapter-question-grid').hidden=true;$('chapter-question-toggle').setAttribute('aria-expanded','false');inspection=null;pendingMove=null;selectedPoints=[];selectedAnswer=null;llmResult=null;llmError=null;llmSettings={enabled:false};llmAutoSeen.clear();$('private-app').hidden=true;for(const id of ['board','profiles','attempts','matches','skills','skill-select','lesson-select','black-player','white-player','rating-sizes','book-select','chapter-select','library-chapter-select','study-route-list','chapter-question-grid'])$(id).replaceChildren();document.querySelectorAll('#private-app input,#private-app textarea').forEach(el=>{if(el.type==='checkbox')el.checked=false;else el.value=''});document.querySelectorAll('#private-app p[id],#private-app h2[id]:not(#menu-title):not(#coach-title),#private-app h3[id],#private-app strong[id],#private-app .llm-answer,#private-app .inline-assessment,#private-app .inspection').forEach(el=>el.textContent='');document.querySelectorAll('#private-app span[id]').forEach(el=>{if(el.id==='turn-pill'){el.querySelector('span').textContent='';}else el.textContent='';});$('pending-move').hidden=true;$('pending-selection').hidden=true;$('pending-answer').hidden=true;$('answer-choices').replaceChildren();$('resign-confirmation').hidden=true;$('toast').hidden=true;}
function lockSession(){authEpoch++;authenticated=false;resetSessionRecovery();refresh.renderPending=false;clearTimeout(pollTimer);clearPrivateUI();$('login-panel').hidden=false;$('logout').hidden=true;navigator.serviceWorker?.controller?.postMessage({type:'CLEAR_PRIVATE_CACHE'});}
function schedulePoll(){clearTimeout(pollTimer);const epoch=authEpoch;if(authenticated&&!document.hidden)pollTimer=setTimeout(async()=>{if(epoch!==authEpoch||document.hidden)return;if(!busy)await lightSync();if(epoch===authEpoch)schedulePoll()},Math.max(12000,syncRetryAt-Date.now()));}
function feedbackText(value){return typeof value==='string'?value:Array.isArray(value)?value.at(-1)?.text||'':value?.text||''}
function setState(next,{inspectionAck=false,growthAction=null}={}){
 const previousGrowthState=state;
 const sameInspectionView=!!state&&inspectionViewKey(state)===inspectionViewKey(next);
 if(!sameInspectionView)inspection=null;
 if(inspectionAck&&sameInspectionView)next={...next,marks:state.marks,message:state.message};
 if(next.inspection)next={...next,marks:(next.marks||[]).filter(mark=>mark.label!=='气')};
 if(next.assisted&&pendingInspectionHelp.delete(inspectionHelpKey(next)))storePendingInspectionHelp();
 if(pendingMove&&(!state||state.revision!==next.revision||state.profile?.id!==next.profile?.id||JSON.stringify(state.board)!==JSON.stringify(next.board)))pendingMove=null;
 if(state?.profile?.id!==next.profile?.id||state?.match?.id!==next.match?.id||state?.revision!==next.revision)$('resign-confirmation').hidden=true;
 const switched=state?.profile?.id!==next.profile?.id;
 if(switched){patternReviewEpoch++;patternWorker?.terminate();patternWorker=null;patternReturn=null;window.GoMatchPatterns?.close();}
 const pickerSkill=$('skill-select').value;
 const autoDifficultyChanged=$('difficulty-select').value==='auto'&&(pickerSkill==='all'?JSON.stringify((state?.learning?.skills||[]).map(s=>[s.id,s.next_difficulty]))!==JSON.stringify((next.learning?.skills||[]).map(s=>[s.id,s.next_difficulty])):(state?.learning?.skills?.find(s=>s.id===pickerSkill)?.next_difficulty||1)!==(next.learning?.skills?.find(s=>s.id===pickerSkill)?.next_difficulty||1));
 const reset=switched||state?.match?.id!==next.match?.id||state?.lesson?.id!==next.lesson?.id||(state?.lesson_attempted&&!next.lesson_attempted)||(state?.move_number>0&&next.move_number===0);
 if(!state||reset||next.lesson_attempted){inspection=null;selectedPoints=[];selectedAnswer=null;$('feedback').value=feedbackText(next.feedback);$('feedback-status').textContent='';}
 if(!state||switched||state?.match?.id!==next.match?.id||state?.mode!==next.mode){selectedMode=next.match?.mode||'lesson';selectionPending=false;}if(switched||reset){$('llm-question').value='';llmError=null;}state=next;if(llmRequest&&(llmRequest.key!==explanationContext()||llmRequest.revision!==state.revision))cancelExplanation();render();globalThis.GoGrowth?.observe(next,{previous:previousGrowthState,actionType:growthAction});if(lessons.length&&(switched||autoDifficultyChanged))renderLessonPicker();scheduleComputer();
}
function canNavigatePractice(){return !busy||['ai_move','review_move'].includes(busyAction);}
function navigationAction(type){return ['lesson','next_lesson','practice_mode','retry','new','resume_match','switch_profile'].includes(type);}
async function act(type,extra={}){
 if(!state)return;
 if(writeRecovery){const recovered=await reconcilePendingWrite();if(authenticated)toast(recovered?'棋盘已同步，请确认当前局面后再操作。':'正在确认上次操作是否已保存，请稍后再试。');if(state)render();return;}
 if(busy){if(!navigationAction(type)||!canNavigatePractice())return;actionRequest?.controller.abort();actionRequest=null;busy=false;busyAction=null;}if(!navigator.onLine){toast('当前离线，联网后继续。');return}
 if(type==='play'&&needsInspectionHelp(state)&&pendingInspectionHelp.has(inspectionHelpKey(state))){
  const view=inspectionViewKey(state),point=firstOccupiedPoint(state.board);
  if(point)await act('inspect',point);
  if(state&&inspectionViewKey(state)===view)toast(state.assisted?'辅助记录已保存，请重新确认落子。':'辅助记录尚未保存，暂不能作答；请联网后再试。');
  return;
 }
 if(type!=='feedback')cancelExplanation();
 const operation={controller:new AbortController(),profileId:state.profile?.id};actionRequest=operation;
 pendingMove=null;renderPending();busy=true;busyAction=type;renderActionStatus();renderPractice();if(type==='ai_move'){aiAttemptKey=`${computerKey()}:${state.revision}`;aiFailedKey=null;}document.body.setAttribute('aria-busy','true');if(type==='ai_move')$('ai-move').textContent='陪练思考中…';
 try{let next;
 for(let attempt=0;attempt<2;attempt++){
  try{next=await request('/api/action',{method:'POST',body:JSON.stringify({type,revision:state.revision,...extra}),signal:operation.controller.signal,handleConflict:false,timeoutMs:type==='ai_move'?22000:type==='review_move'?30000:15000});break;}
  catch(error){if(actionRequest!==operation||error.cancelled)return;if(error.status===409&&error.state?.profile?.id===operation.profileId){setState(error.state);if(navigationAction(type)&&attempt===0)continue;}throw error;}
 }
 if(actionRequest!==operation)return;setState(next,{inspectionAck:type==='inspect',growthAction:type});
 if(['lesson','next_lesson','resume_match','new','solution','retry'].includes(type))showView('board',{focus:true});
 if(['play','pass','undo','switch_profile','new','resume_match'].includes(type))aiFailedKey=null;
 if(['switch_profile','add_profile','retry','lesson','next_lesson','practice_mode','new','resume_match'].includes(type)){$('feedback').value=feedbackText(next.feedback);$('feedback-status').textContent=''}
 if(type==='feedback'){$('feedback-status').textContent=`已保存到${next.profile?.name||'当前学习者'}的记录。`;toast('想法已保存。')}
 if(type==='add_profile'){$('profile-name').value='';document.querySelector('.add-profile').open=false}
 }catch(error){if(actionRequest!==operation||error.cancelled)return;if(type==='ai_move')aiFailedKey=computerKey();toast(error.message);if(error.transient){connected(false);writeRecovery={epoch:authEpoch,revision:state?.revision,profileId:operation.profileId};await reconcilePendingWrite();schedulePoll()}}finally{if(actionRequest===operation){actionRequest=null;busy=false;busyAction=null;document.body.removeAttribute('aria-busy');render();scheduleComputer()}}
}
function textEl(tag,text,className=''){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node}
function renderLearning(){
 globalThis.GoGrowth?.renderCollection(state);
 const profile=state.profile||{name:'我'}, learning=state.learning||{}, recommendation=learning.recommendation||state.recommendation;
 $('profiles').replaceChildren(...(state.profiles||[]).map(p=>{const b=textEl('button',p.name,p.id===profile.id?'profile-option selected':'profile-option');b.setAttribute('aria-pressed',String(p.id===profile.id));b.onclick=()=>{if(p.id!==profile.id)act('switch_profile',{profile_id:p.id})};return b}));
 $('active-profile').textContent=`正在为「${profile.name}」保存进度`;
 $('learning-title').textContent=`${profile.name}的学习进度`;$('learning-stage').textContent=(learning.stage||'等待第一次练习').replace('（不对应段位）','');
 $('learning-count').textContent=learning.attempts_count?`已记录 ${learning.attempts_count} 次作答 · 独立答对 ${learning.independent_correct||0} 次`:'先做几道小题，慢慢了解适合你的练习。';
 $('skills').replaceChildren(...(learning.skills||[]).map(s=>{const row=textEl('div','','skill-row');const top=textEl('div','','skill-row-heading');top.append(textEl('strong',s.name),textEl('span',s.stage||'待评估'));row.append(top,textEl('small',s.independent_attempts?`独立作答 ${s.independent_attempts} 次 · 答对 ${s.correct||0} 次`:'独立作答样本不足，继续练习看看'));return row}));
 $('recommendation-title').textContent=recommendation?.title||'从基础题开始';
 const skillName=(learning.skills||[]).find(s=>s.id===recommendation?.skill)?.name||recommendation?.skill||'';
 $('recommendation-reason').textContent=recommendation?`${skillName} · 难度 ${recommendation.difficulty}\n${recommendation.reason}`:'做一道题后，推荐会随你的练习记录调整。';
 $('history-title').textContent=`${profile.name}的最近练习`;
 const attempts=(state.recent_attempts||[]).slice(0,10);
 $('attempts').replaceChildren(...(attempts.length?attempts.map(a=>{const li=textEl('li');const date=new Date(a.created_at);const when=Number.isNaN(date.getTime())?'':date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});li.append(textEl('strong',a.title),textEl('span',`${a.correct?'答对了':'再练一练'} · ${a.assisted?'提示后作答':a.attempt_no>1?'再次尝试':'独立作答'}`,a.correct?'history-success':'history-retry'),textEl('small',`${when} · 难度 ${a.difficulty}`));return li}):[textEl('li','第一道题完成后，记录会出现在这里。','empty-history')]));
 const a=state.match?.mode==='human_ai'||state.lesson_playout?(state.last_human_assessment||state.assessment):state.assessment, isResult=!!a&&!state.demo_active;
 $('assessment').hidden=!isResult;$('inline-assessment').hidden=!isResult;
 $('assessment-summary').textContent=a?.summary||'';const explanation=a?.review?.explanation||a?.explanation;$('assessment-explanation').textContent=Array.isArray(explanation)?explanation.join(' '):explanation||'';
 $('inline-assessment').replaceChildren();
 if(a){
  $('inline-assessment').append(textEl('span',`${a.correct===true?'✓ ':a.correct===false?'再试试 · ':''}${a.summary}`,'inline-assessment-summary'));
  const detail=$('assessment-explanation').textContent;
  if(detail)$('inline-assessment').append(textEl('span',detail,'inline-assessment-detail'));
 }
 $('assessment').className='assessment '+(a?.correct===true?'success':a?.correct===false?'retry':'neutral');
 $('inline-assessment').className='inline-assessment '+(a?.correct===true?'success':a?.correct===false?'retry':'neutral');
 $('retry-result').hidden=state.mode!=='lesson'||!state.lesson_attempted;$('next-result').hidden=state.mode!=='lesson'||!state.lesson_attempted||state.demo_active;
 $('hint').hidden=!state.lesson||state.lesson_attempted||state.demo_active;
 $('coach-eyebrow').textContent=state.lesson?.interaction==='choose_answer'?'判断练习 · 提交后核对':state.lesson?.interaction==='select_stones'?'选择练习 · 提交后核对':state.lesson?.sequence?'多手练习 · 对手自动应手':isResult?'这一手 · 本地自动反馈':'这一题 · 落子后核对答案';
 const progress=state.lesson_progress,selection=['select_stones','choose_answer'].includes(state.lesson?.interaction);$('lesson-progress').hidden=!progress||state.mode!=='lesson'||state.demo_active;$('lesson-progress').textContent=progress?(selection?`${progress.status==='solved'?'✓ 选择正确':progress.status==='failed'?'本次选择需再想想':'正在选择'}${progress.message?' · '+progress.message:''}`:`${progress.status==='solved'?'✓ 变化完成':state.lesson_playout?(progress.status==='ended'?'续弈已结束':'KataGo 续弈中'):progress.status==='failed'?'本次变化结束':progress.status==='unlisted'?(a?.review?.source==='katago'?'已复核 · 尚未通关':'变化待复核'):'继续计算'} · 已走 ${progress.ply||0} 手${progress.total_min?' / 至少 '+progress.total_min+' 手':''}${progress.message?' · '+progress.message:''}`):'';
 renderMoveReview(a);
 $('show-solution').hidden=state.mode!=='lesson'||!(state.lesson?.sequence||state.lesson?.interaction==='choose_answer')||!state.lesson_attempted||state.demo_active;
 renderPractice();
 renderLessonSource(state.lesson);
 renderTeachingVideos();
 if(state.lesson_attempted&&!state.lesson_playout&&!state.demo_active){$('turn-pill').querySelector('span').textContent='本题已作答';$('turn-pill').className='turn-pill answered';if(!inspection)$('inspection').textContent=state.lesson?.interaction==='choose_answer'?'判断已保存，可重练或继续下一题。':'点棋子数气，或重练、换题。'}
 if(a&&state.message?.includes(a.summary))$('message').hidden=true;
}
function renderMoveReview(assessment){
 const eligible=state.mode==='lesson'&&state.lesson?.sequence&&state.lesson_progress?.status==='unlisted'&&state.lesson_attempted&&!state.demo_active;
 $('review-move').hidden=!eligible;$('review-move').disabled=busy;
 const review=assessment?.review;$('move-review-detail').hidden=!review||state.demo_active;
 $('move-review-source').textContent=review?({rules:'实际提子核对',author:'作者答案复核',deferred:'已保留这手，可以继续下',katago:'KataGo 局部复核',unavailable:'复核暂不可用'}[review.source]||'走法复核'):'';
 const coord=move=>Number.isInteger(move?.x)&&Number.isInteger(move?.y)&&move.x>=0&&move.y>=0&&move.x<(state.size||9)&&move.y<(state.size||9)?`${cols[move.x]}${(state.size||9)-move.y}`:null;
 const pv=(Array.isArray(review?.pv)?review.pv:[]).slice(0,12).map((move,i)=>{const point=coord(move);if(!point)return null;const color=move.color===1||move.color==='B'?'黑':move.color===2||move.color==='W'?'白':'';return `${i+1}. ${color}${point}`;}).filter(Boolean);
 $('move-review-line').textContent=[coord(review?.reference_move)?`参考点：${coord(review.reference_move)}`:'',pv.length?`${review.source==='author'?'作者反驳':'引擎试算'}${review.pv.length>12?'（前12手）':''}：${pv.join(' → ')}`:''].filter(Boolean).join('\n');
 $('move-review-note').textContent=review?.source==='katago'?'引擎复核供参考，不等于本题已过关。':review?.source==='unavailable'?'可重新复核，也可查看参考解法或重练。':'';
 if(eligible)$('assessment').hidden=false;
}
function renderActionStatus(){
 if(inspection||pendingInspectionHelp.has(inspectionHelpKey(state)))renderInspectionText();
 const reviewing=busy&&state?.mode==='lesson'&&busyAction==='review_move',submitting=busy&&['submit_selection','submit_answer'].includes(busyAction);
 $('board-action-status').hidden=!reviewing&&!submitting&&!writeRecovery;
 $('board-action-status').textContent=writeRecovery?'正在确认上次操作是否已保存…':reviewing?'正在重新复核…':submitting?'正在核对选择…':'';
 $('review-move').disabled=busy;$('review-move').textContent=reviewing&&busyAction==='review_move'?'正在复核…':'重新复核';
 if(reviewing){$('inline-assessment').hidden=true;$('turn-pill').querySelector('span').textContent='正在复核…';}
}
function lessonPath(lesson){
 if(lesson?.study_path)return lesson.study_path;
 const source=lesson?.source||{},book=['book','licensed'].includes(source.kind)&&source.title;
 return {id:book?source.title:'basics',title:book||'基础配套练习',rank:source.kind==='licensed'?99:book?10:20,role:source.kind==='licensed'?'extra':book?'main':'supplement',chapter:lesson?.concept||({3:'基础',4:'进阶',5:'挑战'})[lesson?.difficulty]||'基础',chapter_rank:lesson?.difficulty||0,number:Number(String(source.problem||lesson?.id||'').match(/(\d+)\D*$/)?.[1]||0)};
}
function sequentialCollection(lesson){if(!lesson)return null;const p=lessonPath(lesson);return [p.role==='extra'?'licensed':'book',p.title];}
const CONCEPT_NAMES={double_atari:'双打吃',ladder:'征吃',snapback:'倒扑',connection_trap:'接不归',edge_chase:'边线追吃',atari:'打吃',net:'枷吃',gate:'门吃',hug:'抱吃',wedge:'挖吃'};
function sequentialChapter(lesson){if(!lesson)return null;const p=lessonPath(lesson);return (p.role==='supplement'?'配套巩固 · ':'')+(CONCEPT_NAMES[p.chapter]||p.chapter||'练习');}
function compareStudyLessons(a,b){const x=lessonPath(a),y=lessonPath(b);return x.rank-y.rank||(x.role==='extra'&&y.role==='extra'?x.chapter_rank-y.chapter_rank:0)||(x.role==='supplement')-(y.role==='supplement')||x.number-y.number||a.id.localeCompare(b.id,undefined,{numeric:true});}
function courseGroups(){
 const groups=new Map();for(const l of lessons){const p=lessonPath(l);if(!groups.has(p.id))groups.set(p.id,{id:p.id,title:p.title,rank:p.rank,items:[]});groups.get(p.id).items.push(l);}
 return [...groups.values()].sort((a,b)=>a.rank-b.rank||a.title.localeCompare(b.title,'zh'));
}
function supplementaryRepresentatives(items){
 const seen=new Set();return [...items].sort((a,b)=>(a.variant||0)-(b.variant||0)||a.id.localeCompare(b.id,undefined,{numeric:true})).filter(l=>{if(lessonPath(l).role!=='supplement')return true;const family=lessonFamily(l);if(seen.has(family))return false;seen.add(family);return true;});
}
function chapterDirectory(){
 if(chapterDirectoryCache?.lessons===lessons)return chapterDirectoryCache;
 const byId=new Map(lessons.map(l=>[l.id,l])),byChapter=new Map();
 const books=courseGroups().map(book=>{const chapters=new Map();for(const l of supplementaryRepresentatives(book.items)){const name=sequentialChapter(l),p=lessonPath(l);if(!chapters.has(name))chapters.set(name,{name,items:[],rank:p.chapter_rank||0,supplement:p.role==='supplement'});chapters.get(name).items.push(l);}
 const ordered=[...chapters.values()].map(c=>({...c,items:c.items.sort(compareStudyLessons)})).sort((a,b)=>a.supplement-b.supplement||a.rank-b.rank||a.name.localeCompare(b.name,'zh'));
 for(const chapter of ordered)byChapter.set(JSON.stringify([book.id,chapter.name]),chapter);
 return {id:book.id,title:book.title,chapters:ordered};});
 chapterDirectoryCache={lessons,books,byId,byChapter,navigation:new Map()};return chapterDirectoryCache;
}
function bookChapters(){return chapterDirectory().books;}
function currentChapterNavigation(){
 if(!state?.lesson||state.mode!=='lesson')return null;
 const directory=chapterDirectory(),id=state.lesson.id;
 if(directory.navigation.has(id))return directory.navigation.get(id);
 const current=directory.byId.get(id)||state.lesson,p=lessonPath(current),key=JSON.stringify([p.id,sequentialChapter(current)]),chapter=directory.byChapter.get(key);
 if(!chapter)return null;
 // A previously selected rotation remains reachable without reintroducing every duplicate.
 const items=chapter.items.some(l=>l.id===id)?chapter.items:[...chapter.items,current].sort(compareStudyLessons);
 const index=items.findIndex(l=>l.id===id),navigation={key,name:chapter.name,items,index};
 directory.navigation.set(id,navigation);return navigation;
}
function chapterQuestionLabel(lesson,index){const number=lessonPath(lesson).number;return number>0?`第 ${number} 题`:`第 ${index+1} 题`;}
function selectChapterQuestion(id){
 const navigation=currentChapterNavigation();
 if(!navigation||!canNavigatePractice()||state.demo_active||id===state.lesson.id||!navigation.items.some(l=>l.id===id))return;
 act('lesson',{id});
}
function moveChapterQuestion(offset){
 const navigation=currentChapterNavigation(),lesson=navigation?.items[navigation.index+offset];
 if(lesson)selectChapterQuestion(lesson.id);
}
function toggleChapterQuestions(){
 if(!currentChapterNavigation()||!canNavigatePractice()||state.demo_active)return;
 chapterNavigationOpen=!chapterNavigationOpen;renderChapterNavigation();
}
function renderChapterNavigation(){
 const navigation=currentChapterNavigation(),panel=$('chapter-navigation'),grid=$('chapter-question-grid');
 panel.hidden=!navigation;
 if(!navigation){chapterNavigationOpen=false;chapterNavigationKey=null;chapterGridItems=null;grid.replaceChildren();grid.hidden=true;$('chapter-question-toggle').setAttribute('aria-expanded','false');return;}
 const {key,name,items,index}=navigation,disabled=!canNavigatePractice()||state.demo_active;
 if(chapterNavigationKey!==key){chapterNavigationOpen=false;chapterNavigationKey=key;}
 $('chapter-navigation-name').textContent=name;
 $('chapter-current-question').textContent=chapterQuestionLabel(items[index],index);
 $('chapter-question-position').textContent=`${index+1} / ${items.length} · 选题`;
 $('chapter-previous').disabled=disabled||index===0;$('chapter-next').disabled=disabled||index===items.length-1;
 $('chapter-question-toggle').disabled=disabled;$('chapter-question-toggle').setAttribute('aria-expanded',String(chapterNavigationOpen));
 grid.hidden=!chapterNavigationOpen;
 if(chapterGridItems!==items){grid.replaceChildren(...items.map((lesson,i)=>{const button=textEl('button',String(lessonPath(lesson).number||i+1));button.type='button';button.dataset.lessonId=lesson.id;button.setAttribute('aria-label',`${chapterQuestionLabel(lesson,i)}，章节内第 ${i+1} 题`);button.onclick=()=>selectChapterQuestion(lesson.id);return button;}));chapterGridItems=items;}
 for(const button of grid.children){button.disabled=disabled;const current=button.dataset.lessonId===state.lesson.id;if(current)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');}
}
function renderChapterPicker(){
 const books=bookChapters(),select=$('chapter-select');
 $('chapter-picker').hidden=!books.length;
 select.disabled=!canNavigatePractice()||state.demo_active;
 const placeholder=textEl('option','选择练习章节…');placeholder.value='';placeholder.disabled=true;
 select.replaceChildren(placeholder);
 const current=chapterDirectory().byId.get(state.lesson?.id)||state.lesson;
 const currentTitle=sequentialCollection(current)?.[1]||(current?lessonPath(current).title:'');
 const currentChapter=sequentialChapter(current);
 let selected='';
 for(const book of books){const group=document.createElement('optgroup');group.label=book.title;
  for(const chapter of book.chapters){const first=chapter.items[0],option=textEl('option',`${chapter.name} · ${chapter.items.length} 题`);option.value=first.id;group.append(option);
   if(currentTitle===book.title&&currentChapter===chapter.name)selected=first.id;
  }select.append(group);
 }
 select.value=selected;
}
function renderPractice(){
 const mode=state.practice_mode||'recommended',p=state.practice_progress||{};
 renderChapterPicker();renderChapterNavigation();
 $('practice-mode').value=mode;$('practice-mode').disabled=!canNavigatePractice()||state.demo_active;
 const sequential=mode==='sequential',review=mode==='review',empty=(review&&p.review_count===0)||(sequential&&p.remaining===0)||(p.path_title==='三书主线'&&p.main_path_complete===true)||(!review&&p.study_path&&p.next_id===null);
 $('practice-progress').textContent=sequential?`已通过 ${p.completed||0} / ${p.total||lessons.length} 关${p.current_index?' · 当前第 '+p.current_index+' 关':''}`:review?`待复习 ${p.review_count||0} 题`:'按教材主线和你的学习记录安排';
 $('next-practice-eyebrow').textContent=sequential?'顺序练习':review?'错题复习':'适合你的下一题';
 if(sequential){$('recommendation-title').textContent=p.remaining===0?'这一轮已全部通过':`继续第 ${p.next_index||1} 关`;$('recommendation-reason').textContent=(p.book_title?[p.book_title,p.chapter].filter(Boolean).join(' · ')+(p.path_title==='自选拓展'?'。继续当前选做题集，不影响教材成绩。':'。按原书题号继续，完成后进入下一本教材。'):'按手筋入门到10级、手筋10级到5级、死活入门到10级的顺序练习。基础巩固和 Go Game Guru 可在题库选做。')+'看过解答再做对也能过关，但不增加独立答题积分。';}
 if(p.path_title==='三书主线'&&p.main_path_complete&&mode!=='review'){$('recommendation-title').textContent='三本教材已完成';$('recommendation-reason').textContent='可以从题库自选配套巩固或最后的 Go Game Guru 拓展题。';}
 if(p.path_title==='自选拓展'&&p.next_id===null&&mode!=='review'){$('recommendation-title').textContent='这套拓展题已完成';$('recommendation-reason').textContent='可以回到题库选择教材或配套巩固。';}
 if(review){$('recommendation-title').textContent=empty?'暂时没有待复习题':'再练一次，弄懂它';$('recommendation-reason').textContent=empty?'可以切换智能推荐，或去题库挑题。':'重练还没做对的题；未收录的变化也留在这里，做对后移出。';}
 $('next-lesson').textContent=sequential?'继续练习 →':review?'开始复习 →':'开始推荐练习 →';
 $('next-result').textContent=sequential?'下一题 →':review?'复习下一题 →':'练下一题 →';
 $('next-lesson').disabled=!canNavigatePractice()||empty||state.demo_active;$('next-result').disabled=!canNavigatePractice()||empty;
}
function lessonFamily(l){return l.base_id||l.family_id||(l.variant!==undefined?l.id.replace(/-\d+$/,''):l.id)}
function sourceText(source){if(typeof source==='string')return source;if(!source)return '内置练习';return [source.title||source.book||source.name,source.page?'第 '+source.page+' 页':'',source.problem||source.problem_number||source.number?'题号 '+(source.problem||source.problem_number||source.number):'',source.kind==='licensed'&&source.author?'作者：'+source.author:'',source.kind==='licensed'?'':source.note].filter(Boolean).join(' · ')||'内置练习'}
function lessonSource(l){return `${l.size||9} 路 · ${sourceText(l.source)} · ${l.variant>1?'旋转 / 镜像变式 '+l.variant:l.variant===1?'原始局面':l.sequence?'多手局面':'基础局面'}`}
function renderLessonSource(lesson){
 const line=$('lesson-source');line.hidden=!lesson;line.replaceChildren();if(!lesson)return;line.append(document.createTextNode(lessonSource(lesson)));
 if(lesson.source?.kind!=='licensed')return;
 const addLink=(label,url)=>{const link=textEl('a',label);link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';line.append(document.createTextNode(' · '),link);};
 addLink('CC BY-NC-SA 4.0','https://creativecommons.org/licenses/by-nc-sa/4.0/');
 try{const url=new URL(lesson.source.url);if(url.protocol==='https:'&&!url.username&&!url.password)addLink('原题',url.href);}catch{}
}
function renderBookPicker(){
 const previous=$('book-select').value,books=courseGroups();$('book-filter').hidden=!books.length;
 $('book-select').replaceChildren(...books.map(book=>{const o=textEl('option',(book.id==='gogameguru'?'补充 · ':'')+book.title);o.value=book.id;return o;}));
 $('book-select').value=books.some(b=>b.id===previous)?previous:(books.find(b=>b.rank===1)||books[0])?.id||'';
 const route=$('study-route-list');route.replaceChildren();
 for(const book of books.filter(b=>b.rank<=3)){const main=book.items.filter(l=>lessonPath(l).role==='main');if(!main.length)continue;
  const item=document.createElement('li'),button=textEl('button',`${book.rank}. ${book.title}`);button.type='button';button.className='secondary study-book';button.dataset.studyBook=book.id;button.append(textEl('span',`已收录 ${main.length} 题`));button.onclick=()=>{selectStudyBook(book.id);$('lesson-select').focus();};item.append(button);route.append(item);
 }
 $('study-route').hidden=!route.children.length;
}
function selectStudyBook(id){$('book-select').value=id;$('skill-select').value='all';$('difficulty-select').value='all';$('library-chapter-select').value='all';$('include-supplements').checked=false;renderLessonPicker();}
function renderSkillPicker(){
 renderBookPicker();
 if(state)renderChapterPicker();
 const previous=$('skill-select').value,names=Object.fromEntries((state?.learning?.skills||[]).map(s=>[s.id,s.name]));
 const ids=['all',...new Set(lessons.map(l=>l.skill))];
 $('skill-select').replaceChildren(...ids.map(id=>{const o=textEl('option',id==='all'?'全部知识点':names[id]||id);o.value=id;return o}));
 $('skill-select').value=ids.includes(previous)?previous:'all';renderLessonPicker();
}
function renderLessonPicker(){
 const skill=$('skill-select').value,choice=$('difficulty-select').value,book=$('book-select').value;
 const bookItems=lessons.filter(l=>lessonPath(l).id===book),hasSupplements=bookItems.some(l=>lessonPath(l).role==='supplement'),hasMain=bookItems.some(l=>lessonPath(l).role==='main');
 $('supplement-filter').hidden=!hasSupplements||!hasMain;const include=$('include-supplements').checked||!hasMain;
 const eligible=supplementaryRepresentatives(bookItems.filter(l=>include||lessonPath(l).role!=='supplement')).sort(compareStudyLessons);
 const chapterSelect=$('library-chapter-select'),previousChapter=chapterSelect.value,chapters=new Map();
 for(const l of eligible){const p=lessonPath(l);if(!chapters.has(p.chapter))chapters.set(p.chapter,p.chapter_rank||0);}
 chapterSelect.replaceChildren(...['all',...[...chapters].sort((a,b)=>a[1]-b[1]).map(([name])=>name)].map(name=>{const o=textEl('option',name==='all'?'全部章节':CONCEPT_NAMES[name]||name);o.value=name;return o;}));chapterSelect.value=chapters.has(previousChapter)?previousChapter:'all';
 const chapter=chapterSelect.value,options=eligible.filter(l=>(chapter==='all'||lessonPath(l).chapter===chapter)&&(skill==='all'||l.skill===skill)&&(choice==='all'||l.difficulty===(choice==='auto'?(state?.learning?.skills?.find(s=>s.id===l.skill)?.next_difficulty||1):Number(choice)))),previous=$('lesson-select').value;
 $('lesson-select').replaceChildren(...options.map(l=>{const o=textEl('option',`${lessonPath(l).role==='supplement'?'配套巩固 · ':''}${l.title} · ${l.size||9} 路${l.sequence?' · 连续应手':''}`);o.value=l.id;return o;}));
 if(options.some(l=>l.id===previous))$('lesson-select').value=previous;
 else if(options.length)$('lesson-select').value=options[0].id;
 $('start-skill').disabled=!options.length;$('lesson-select').disabled=!options.length;
 const chosen=options.find(l=>l.id===$('lesson-select').value),mainCount=options.filter(l=>lessonPath(l).role==='main').length,supplementCount=options.filter(l=>lessonPath(l).role==='supplement').length;
 $('lesson-count').textContent=options.length?`${options.length} 道题${supplementCount?` · ${mainCount} 道书题 / ${supplementCount} 道配套巩固`:''}${chosen?'\n'+lessonSource(chosen):''}`:'当前筛选没有题目，可以选择“全部章节”或其他难度。';
 const numbers=bookItems.filter(l=>lessonPath(l).role==='main').map(l=>lessonPath(l).number).filter(Number.isFinite),first=numbers.length?Math.min(...numbers):null,last=numbers.length?Math.max(...numbers):null;
 $('book-study-note').textContent=book==='gogameguru'?'Go Game Guru 的公开每周围棋题，由 David Ormerod 与职业棋手 An Younggil 编写。作为三本教材之后的选做补充，原题保留作者与许可。':!hasMain?'本组为配套巩固，按知识点选做；有对应教材时，以书题作为学习主线。':book==='beginner-tesuji'?`当前已收录第${first}–${last}题${first>1?`，前${first-1}题尚未入库`:''}。按原书顺序练习，基础巩固可按需展开。`:book==='intermediate-tesuji'?`前后部分已合并，按第${first}–${last}题接续${first<=421&&last>=421&&!numbers.includes(421)?'；第421题因原图答案不清暂未收录':''}。`:`当前已收录第${first}–${last}题，按原书章节和题号练习；配套巩固不计入教材必做顺序。`;

 for(const button of document.querySelectorAll('[data-study-book]'))button.setAttribute('aria-pressed',String(button.dataset.studyBook===book));
}
let boardFocusKey=null, boardFocusFull=false;
function lessonBoardBounds(s){
 const size=s.size||9;
 if(s.mode!=='lesson'||!s.lesson||size!==19)return null;
 const points=[],add=(x,y)=>{if(Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<size&&y<size)points.push([x,y]);};
 for(const board of [s.initial_board,s.board])if(Array.isArray(board))for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(board[y]?.[x])add(x,y);
 for(const p of s.lesson.stones||[])add(p.x,p.y);
 const bounds=s.lesson.focus_bounds||s.focus_bounds;
 if(bounds&&[bounds.min_x,bounds.min_y,bounds.max_x,bounds.max_y].every(Number.isInteger)&&bounds.min_x<=bounds.max_x&&bounds.min_y<=bounds.max_y){add(bounds.min_x,bounds.min_y);add(bounds.max_x,bounds.max_y);}
 for(const p of [...(s.moves||[]),...(s.marks||[])])if(!p.pass)add(p.x,p.y);
 if(!points.length)return null;
 const padded=axis=>{let lo=Math.max(0,Math.min(...points.map(p=>p[axis]))-2),hi=Math.min(size-1,Math.max(...points.map(p=>p[axis]))+2);const missing=Math.max(0,9-(hi-lo+1));lo=Math.max(0,lo-Math.floor(missing/2));hi=Math.min(size-1,lo+Math.max(9,hi-lo+1)-1);lo=Math.max(0,Math.min(lo,hi-8));return [lo,hi]};
 const [minX,maxX]=padded(0),[minY,maxY]=padded(1);
 if(Math.max(maxX-minX,maxY-minY)>=size-1)return null;
 return {minX,maxX,minY,maxY};
}
function renderBoard(){
 const root=$('board'),size=state.size||9;
 const focusKey=JSON.stringify([state.profile?.id,state.lesson?.id,size,state.initial_board]);
 if(focusKey!==boardFocusKey){boardFocusKey=focusKey;boardFocusFull=false;}
 const proposed=lessonBoardBounds(state),focused=!!proposed&&!boardFocusFull;
 const renderKey=JSON.stringify([focusKey,state.board,state.last_move,state.marks,inspection,pendingMove,selectedPoints,boardZoom,focused,proposed]);
 if(renderKey===boardRenderKey&&root.childElementCount)return;
 boardRenderKey=renderKey;
 const {minX,maxX,minY,maxY}=focused?proposed:{minX:0,maxX:size-1,minY:0,maxY:size-1};
 const width=maxX-minX,height=maxY-minY,step=432/Math.max(width,height);
 const startX=54+(432-width*step)/2,startY=54+(432-height*step)/2;
 const atX=x=>startX+(x-minX)*step,atY=y=>startY+(y-minY)*step;
 const focusButton=$('board-focus');focusButton.hidden=!proposed;focusButton.textContent=focused?'查看全盘':'放大棋题局部';focusButton.setAttribute('aria-pressed',String(focused));focusButton.onclick=()=>{boardFocusFull=!boardFocusFull;renderBoard()};
 const note=$('board-focus-note');note.hidden=!focused;note.textContent=focused?`当前显示 ${cols[minX]}${size-minY} 至 ${cols[maxX]}${size-maxY} 的局部，仍是 ${size} 路棋盘。虚线外仍有棋盘，虚线不是棋盘边缘。`:'';
 $('board-zoom').hidden=size!==19||focused;document.querySelector('.board-shell').classList.toggle('board-focused',focused);document.querySelector('.board-shell').classList.toggle('board-zoomed',size===19&&boardZoom&&!focused);
 root.setAttribute('aria-label',`${size} 路围棋棋盘`);root.dataset.focused=String(focused);root.dataset.visibleBounds=[minX,minY,maxX,maxY].join(',');if(focused)root.setAttribute('aria-describedby','board-focus-note');else root.removeAttribute('aria-describedby');
 root.replaceChildren();const defs=svg('defs');
 for(const [id,c1,c2]of[['blackStone','#48504a','#151c19'],['whiteStone','#fffefa','#d7d8cc']]){const g=svg('radialGradient',{id,cx:'33%',cy:'26%',r:'75%'});g.append(svg('stop',{offset:'0%','stop-color':c1}),svg('stop',{offset:'100%','stop-color':c2}));defs.append(g)}root.append(defs);
 const left=atX(minX)-(minX>0?step*.3:0),right=atX(maxX)+(maxX<size-1?step*.3:0),top=atY(minY)-(minY>0?step*.3:0),bottom=atY(maxY)+(maxY<size-1?step*.3:0);
 for(let y=minY;y<=maxY;y++){root.append(svg('line',{x1:left,y1:atY(y),x2:right,y2:atY(y),class:'board-line'+(y===0||y===size-1?' board-real-edge':'')}));for(const x of [atX(minX)-30,atX(maxX)+30])root.append(svg('text',{x,y:atY(y),class:'coord'},String(size-y)));}
 for(let x=minX;x<=maxX;x++){root.append(svg('line',{x1:atX(x),y1:top,x2:atX(x),y2:bottom,class:'board-line'+(x===0||x===size-1?' board-real-edge':'')}));for(const y of [atY(minY)-30,atY(maxY)+30])root.append(svg('text',{x:atX(x),y,class:'coord'},cols[x]));}
 if(focused){for(const [show,x1,y1,x2,y2]of[[minX>0,left,top,left,bottom],[maxX<size-1,right,top,right,bottom],[minY>0,left,top,right,top],[maxY<size-1,left,bottom,right,bottom]])if(show)root.append(svg('line',{x1,y1,x2,y2,class:'board-crop-boundary'}));}
 for(const [x,y]of(size===19?[3,9,15].flatMap(x=>[3,9,15].map(y=>[x,y])):[[2,2],[6,2],[4,4],[2,6],[6,6]]))if(x>=minX&&x<=maxX&&y>=minY&&y<=maxY)root.append(svg('circle',{cx:atX(x),cy:atY(y),r:Math.min(3.1,step*.09),fill:'#6c583c'}));
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
  const color=state.board[y][x],cx=atX(x),cy=atY(y),g=svg('g',{class:'intersection',role:state.lesson?.interaction==='choose_answer'?'img':'button',tabindex:state.lesson?.interaction==='choose_answer'?'-1':'0','aria-label':`${cols[x]}${size-y} ${color===1?'黑子':color===2?'白子':'空位'}`});
  g.append(svg('rect',{x:cx-step/2,y:cy-step/2,width:step,height:step,fill:'transparent',rx:7,class:'hit'}));
  if(color){g.append(svg('ellipse',{cx:cx+1,cy:cy+3,rx:step*.445,ry:step*.43,fill:'#5c48243a'}),svg('circle',{cx,cy,r:step*.435,fill:`url(#${color===1?'blackStone':'whiteStone'})`,stroke:color===1?'#1c2620':'#b7b6a4','stroke-width':.6}));if(state.last_move?.x===x&&state.last_move?.y===y)g.append(svg('circle',{cx,cy,r:Math.min(5,step*.13),fill:'none',stroke:color===1?'#f1e7cc':'#526957','stroke-width':2}));}
  if(inspection?.stones?.some(s=>s.x===x&&s.y===y))g.append(svg('circle',{cx,cy,r:step*.46,fill:'none',stroke:'#58896d','stroke-width':3}));
  if(inspection?.liberties?.some(s=>s.x===x&&s.y===y))g.append(svg('circle',{cx,cy,r:Math.min(9,step*.2),fill:'#f4fbdb',stroke:'#597a42','stroke-width':2}));
  if(pendingMove?.x===x&&pendingMove?.y===y)g.append(svg('circle',{cx,cy,r:step*.4,fill:state.to_play===1?'#253b34':'#fffdf7',opacity:.55,stroke:'#b7853c','stroke-width':2,'stroke-dasharray':'3 2'}));
  if(selectedPoints.some(p=>p[0]===x&&p[1]===y))g.append(svg('path',{d:`M ${cx} ${cy-step*.27} L ${cx-step*.25} ${cy+step*.22} L ${cx+step*.25} ${cy+step*.22} Z`,fill:'none',stroke:'#bd6f26','stroke-width':Math.max(2,step*.07),'stroke-linejoin':'round'}));
  const mark=state.marks?.find(m=>m.x===x&&m.y===y);if(mark&&!(mark.label==='气'&&inspection)){g.append(svg('circle',{cx,cy,r:Math.min(16,step*.32),fill:color?'#b7853cd9':'#f4eee0e8',stroke:'#a17635','stroke-width':2}),svg('text',{x:cx,y:cy+1,'text-anchor':'middle','dominant-baseline':'middle',fill:color?'#fff':'#735224','font-size':Math.min(14,step*.4),'font-weight':700},mark.label||'·'));}
  const onClick=()=>{
   if(state.lesson?.interaction==='choose_answer')return;
   if(state.lesson?.interaction==='select_stones'){
    if(busy)return;if(state.lesson_attempted||state.demo_active){toast('本题已作答，请重练或换题。');return;}if(color!==state.lesson.selection_color){toast('这道题只需选择白子。');return;}
    const index=selectedPoints.findIndex(p=>p[0]===x&&p[1]===y);if(index>=0)selectedPoints.splice(index,1);else selectedPoints.push([x,y]);inspection=null;pendingMove=null;render();return;
   }
   if(color){inspectLocal(x,y);return;}if(busy)return;
   if(state.computer_turn){toast('现在轮到电脑，请等它落子。');return;}
   if((state.lesson_attempted&&!state.lesson_playout)||state.demo_active){toast(state.demo_active?'请先返回原局面。':'本题已作答，请重练或换题。');return;}
   clearInspection();
   if($('confirm-enabled').checked){pendingMove={x,y,revision:state.revision,profile:state.profile?.id};render();$('pending-move').scrollIntoView({block:'nearest'});return;}
   act('play',{x,y});
  };
  g.addEventListener('click',onClick);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onClick()}});root.append(g);
 }
}
function render(){if(!state)return;renderPending();renderSelection();renderAnswer();const choosing=state.lesson?.interaction==='choose_answer',selecting=state.lesson?.interaction==='select_stones'&&!state.lesson_attempted;$('board-zoom').textContent=boardZoom?'缩回棋盘':'放大棋盘';$('board-zoom').setAttribute('aria-pressed',String(boardZoom));$('board-prompt').textContent=state.lesson?.prompt||'';$('board-prompt').hidden=!state.lesson;renderBoard();$('board-title').textContent=state.demo_active?(choosing?'查看参考答案':'看一看这段变化'):state.lesson?.title||'自在落子，慢慢看清';$('board-eyebrow').textContent=`${state.size||9} 路 · ${state.mode==='lesson'?`练习 · 难度 ${state.lesson?.difficulty||1}`:'自由对弈'}`;$('turn-pill').className='turn-pill'+(selecting||choosing?' selecting':state.to_play===2?' white':'');$('turn-pill').querySelector('span').textContent=state.ended?'本局已结束':choosing?(state.demo_active?'参考答案':state.lesson_attempted?'判断已提交':'请选择答案'):selecting?'请选择白子':`轮到${state.to_play===1?'黑':'白'}棋`;$('move-count').textContent=choosing?'观察棋形，选择答案':selecting?`已选 ${selectedPoints.length} 颗`:`第 ${state.move_number||0} 手`;$('captures').textContent=`黑提 ${state.captures?.black||0} 子 · 白提 ${state.captures?.white||0} 子`;$('prompt-title').textContent=state.lesson?.title||'每一手，都可以停下来想';$('prompt').textContent=state.lesson?.prompt||'黑白交替落子，试着观察棋子的气。需要对手时，点击“请陪练下一手”；想讨论时，把你的想法写下来。';$('message').textContent=state.message||'';$('message').hidden=!state.message||state.message===state.lesson?.prompt;$('hint').hidden=!state.lesson;$('restore-demo').hidden=!state.demo_active;$('demo-next').hidden=!state.demo_active||choosing;$('demo-next').disabled=(state.demo_step||0)>=(state.demo_total||0);$('demo-next').textContent=`演示下一手 · ${state.demo_step||0}/${state.demo_total||0}`;$('ai-move').hidden=state.mode!=='free'||state.demo_active;$('ai-move').disabled=!state.engine?.available||state.ended;$('pass').disabled=state.ended||state.demo_active||state.mode==='lesson';$('undo').disabled=!state.history?.length||state.demo_active;$('restart').textContent=state.mode==='lesson'?'重练这一题':'新开一局';document.querySelector('.confirm-setting').hidden=selecting||choosing;renderInspectionText();$('engine-note').textContent=state.engine?.available?`KataGo · ${state.engine.status||'已配置'}。${state.engine.note||'点击按钮才会下下一手。'}${state.engine.error?' 引擎提示：'+state.engine.error:''}`:'陪练引擎尚未配置 · 仍可做题、数气、黑白交替下棋。';document.querySelectorAll('.lesson-option').forEach(b=>b.classList.toggle('selected',b.dataset.id===state.lesson?.id));$('saved').textContent=cloudMode?'已保存到家庭账号':'已保存到本机';renderLearning();renderMatch();renderLLM();renderRating();renderBoardChrome();renderActionStatus();}
const INSPECTION_HELP_STORAGE='go-coach-pending-inspection-help';
function readPendingInspectionHelp(){
 try{const values=JSON.parse(sessionStorage.getItem('go-coach-pending-inspection-help')||'[]');return new Set(Array.isArray(values)?values.filter(v=>typeof v==='string'):[]);}catch{return new Set();}
}
function storePendingInspectionHelp(){try{sessionStorage.setItem(INSPECTION_HELP_STORAGE,JSON.stringify([...pendingInspectionHelp]));}catch{}}
function inspectionHelpKey(s){return JSON.stringify([s?.profile?.id||null,s?.lesson?.id||null]);}
function inspectionViewKey(s){return JSON.stringify([s?.profile?.id,s?.lesson?.id,s?.match?.id,s?.mode,s?.demo_active,s?.board]);}
function needsInspectionHelp(s){return s?.mode==='lesson'&&!!s.lesson&&!s.lesson_attempted&&!s.demo_active&&!s.assisted;}
function firstOccupiedPoint(board){for(let y=0;y<board.length;y++)for(let x=0;x<board.length;x++)if(board[y][x])return {x,y};return null;}
function localInspection(board,x,y){
 const color=board[y]?.[x],result={color:color||0,stones:[],liberties:[]};if(!color)return result;
 const size=board.length,seen=new Set(),liberties=new Set(),pending=[[x,y]];
 while(pending.length){const [a,b]=pending.pop(),id=b*size+a;if(seen.has(id))continue;seen.add(id);result.stones.push({x:a,y:b});
  for(const [nx,ny]of [[a-1,b],[a+1,b],[a,b-1],[a,b+1]]){
   if(nx<0||ny<0||nx>=size||ny>=size)continue;
   if(board[ny][nx]===color)pending.push([nx,ny]);else if(!board[ny][nx])liberties.add(ny*size+nx);
  }
 }
 result.liberties=[...liberties].map(id=>({x:id%size,y:Math.floor(id/size)}));return result;
}
function renderInspectionText(){
 if(state?.lesson?.interaction==='choose_answer'){$('inspection').textContent=state.demo_active?state.message:state.lesson_attempted?'判断已保存，可重练或继续下一题。':'观察棋形，再用答案按钮作答。';return;}
 if(state?.lesson?.interaction==='select_stones'&&!state.lesson_attempted){$('inspection').textContent=selectedPoints.length?`已选择 ${selectedPoints.length} 颗白子；再次点击可取消。`:'点击需要标记的白子，再提交答案。';return;}
 $('inspection').textContent=inspection?(inspection.stones.length?`${inspection.color===1?'黑':'白'}棋 · ${inspection.stones.length} 子 · ${inspection.liberties.length} 口气`:'点空位落子，点棋子数气。'):'点空位落子，点棋子数气。';
 if(needsInspectionHelp(state)&&pendingInspectionHelp.has(inspectionHelpKey(state)))$('inspection').textContent+=busyAction==='inspect'?' · 辅助记录保存中':' · 保存辅助记录后才能作答';
}
function inspectLocal(x,y){
 if(!state)return;inspection=localInspection(state.board,x,y);pendingMove=null;
 const record=inspection.stones.length&&needsInspectionHelp(state);
 if(record){pendingInspectionHelp.add(inspectionHelpKey(state));storePendingInspectionHelp();}
 renderBoard();renderInspectionText();renderPending();$('inspection').hidden=false;
 if(record&&!busy&&navigator.onLine)void act('inspect',{x,y});
}
function clearInspection(){if(!pendingMove&&!inspection&&!(state?.marks||[]).some(mark=>mark.label==='气'))return;pendingMove=null;inspection=null;if(state){state.marks=(state.marks||[]).filter(mark=>mark.label!=='气');renderBoard();renderInspectionText();renderPending();}}
function renderPending(){$('pending-move').hidden=!pendingMove;$('pending-label').textContent=pendingMove?`准备落在 ${cols[pendingMove.x]}${state.size-pendingMove.y}`:'';}
function renderSelection(){const active=state?.lesson?.interaction==='select_stones'&&!state.lesson_attempted&&!state.demo_active;$('pending-selection').hidden=!active;$('selection-label').textContent=selectedPoints.length?`已选择 ${selectedPoints.length} 颗白子`:'尚未选择白子';$('submit-selection').disabled=busy||!selectedPoints.length;}
function renderAnswer(){
 const active=state?.lesson?.interaction==='choose_answer'&&!state.lesson_attempted&&!state.demo_active;
 $('pending-answer').hidden=!active;if(!active){$('answer-choices').replaceChildren();return;}
 const choices=state.lesson.choices||[];
 if(!choices.some(choice=>choice.id===selectedAnswer))selectedAnswer=null;
 $('answer-choices').replaceChildren(...choices.map((choice,index)=>{
  const button=textEl('button',choice.label,'answer-option secondary');button.type='button';button.disabled=busy;
  button.setAttribute('aria-pressed',String(selectedAnswer===choice.id));
  button.onclick=()=>{if(busy)return;selectedAnswer=choice.id;renderAnswer();$('answer-choices').children[index]?.focus({preventScroll:true});};return button;
 }));
 $('answer-label').textContent=selectedAnswer===null?'请选择一个答案':`已选择：${choices.find(choice=>choice.id===selectedAnswer).label}`;
 $('submit-answer').disabled=busy||selectedAnswer===null;
}
$('submit-answer').onclick=()=>{if(selectedAnswer!==null)act('submit_answer',{answer:selectedAnswer})};
$('confirm-enabled').checked=confirmDefault;
$('confirm-enabled').onchange=()=>{pendingMove=null;if(state)render()};
$('cancel-move').onclick=()=>{pendingMove=null;if(state)render()};
$('confirm-move').onclick=()=>{const move=pendingMove;if(!move||!state)return;if(move.revision!==state.revision||move.profile!==state.profile?.id){pendingMove=null;render();return}act('play',{x:move.x,y:move.y})};
$('clear-selection').onclick=()=>{selectedPoints=[];selectedAnswer=null;if(state)render()};$('submit-selection').onclick=()=>{if(selectedPoints.length)act('submit_selection',{points:selectedPoints.map(p=>[...p])})};
$('board-zoom').onclick=()=>{boardZoom=!boardZoom;if(state)render()};
$('undo').onclick=()=>act('undo');$('pass').onclick=()=>act('pass');$('hint').onclick=()=>act('hint');$('restart').onclick=()=>{if(state.lesson)act('retry');else startMatch(true)};$('ai-move').onclick=()=>{aiAttemptKey=null;aiFailedKey=null;act('ai_move')};$('restore-demo').onclick=()=>act('restore_demo');$('demo-next').onclick=()=>act('demo_next');$('send-feedback').onclick=()=>{const text=$('feedback').value.trim();if(!text){toast('先写一点你的想法吧，一句话也可以。');$('feedback').focus();return}act('feedback',{text})};
$('show-solution').onclick=()=>act('solution');$('review-move').onclick=()=>act('review_move');
$('practice-mode').onchange=()=>{if(!canNavigatePractice()||!state||state.demo_active){if(state)renderPractice();return;}act('practice_mode',{mode:$('practice-mode').value});};
$('chapter-previous').onclick=()=>moveChapterQuestion(-1);$('chapter-next').onclick=()=>moveChapterQuestion(1);$('chapter-question-toggle').onclick=toggleChapterQuestions;
$('chapter-select').onchange=()=>{
 const id=$('chapter-select').value;
 if(!canNavigatePractice()||!state||state.demo_active){if(state)renderPractice();return;}
 if(!bookChapters().some(book=>book.chapters.some(chapter=>chapter.items[0].id===id))){renderPractice();return;}
 act('lesson',{id});
};
$('retry-result').onclick=()=>act('retry');$('next-result').onclick=()=>act('next_lesson');$('next-lesson').onclick=()=>act('next_lesson');
$('profile-form').onsubmit=e=>{e.preventDefault();const name=$('profile-name').value.trim();if(name)act('add_profile',{name})};
$('book-select').onchange=()=>selectStudyBook($('book-select').value);
$('library-chapter-select').onchange=renderLessonPicker;$('include-supplements').onchange=renderLessonPicker;
$('skill-select').onchange=renderLessonPicker;$('difficulty-select').onchange=()=>{$('skill-select').value='all';renderLessonPicker()};$('lesson-select').onchange=renderLessonPicker;
$('start-skill').onclick=()=>{const id=$('lesson-select').value;if(id){clearInspection();act('lesson',{id})}};
$('lesson-import-form').onsubmit=async e=>{
 e.preventDefault();if(busy||!state)return;const file=$('lesson-file').files[0];if(!file)return;
 if(file.size>240*1024){$('import-status').textContent='文件过大，请选择不超过 240 KiB 的单题 JSON。';return}
 busy=true;$('import-lesson').disabled=true;$('import-status').textContent='正在核对并导入…';
 try{const parsed=JSON.parse(await file.text());const result=await request('/api/lessons/import',{method:'POST',body:JSON.stringify({lesson:parsed.lesson||parsed,revision:state.revision})});
 const data=await request('/api/lessons');lessons=Array.isArray(data)?data:data.lessons||[];if(result.state)setState(result.state);renderSkillPicker();
 const imported=result.lesson; if(imported){$('skill-select').value=imported.skill;$('difficulty-select').value=String(imported.difficulty);renderLessonPicker();$('lesson-select').value=imported.id;renderLessonPicker();busy=false;await act('lesson',{id:imported.id});}
 $('import-status').textContent='已导入题库，可在具体题目中重新选择。';$('lesson-file').value='';
 }catch(error){$('import-status').textContent=error instanceof SyntaxError?'无法读取 JSON，请使用 Codex 生成并核对的题库文件。':error.message}
 finally{busy=false;$('import-lesson').disabled=false;}
};
function computerKey(){return state?.computer_turn?`${state.profile?.id||'profile'}:${state.match?.id||state.match_id||state.lesson?.id||state.mode}:${state.revision}:${state.move_number}:${state.to_play}`:null}
function scheduleComputer(){setTimeout(()=>{const key=computerKey();if(!busy&&key&&!state.demo_active&&!state.ended&&state.engine?.available&&`${key}:${state.revision}`!==aiAttemptKey&&key!==aiFailedKey)act('ai_move')},0)}
function selectMode(mode){if(busy)return;selectedMode=mode;selectionPending=true;if(mode==='lesson'){if(state.mode!=='lesson')act('next_lesson');else {selectionPending=false;renderMatch()}}else renderMatch()}
function startMatch(useCurrent=false){
 const match=useCurrent?state.match:null, mode=match?.mode||selectedMode;
 const size=useCurrent?(state.size||9):Number($('board-size').value);
 if(mode==='human_ai')act('new',{match_mode:mode,size,human_color:match?.human_color||(match?.black?.type==='ai'?2:match?.white?.type==='ai'?1:Number($('human-color').value))});
 else if(mode==='two_player'){
  const black=match?.black?.profile_id||$('black-player').value,white=match?.white?.profile_id||$('white-player').value;
  if(black===white){toast('请为黑方和白方选择不同的学习者。');return}
  act('new',{match_mode:mode,size,black_profile_id:black,white_profile_id:white});
 }
}
function renderMatch(){
 $('review-match-patterns').hidden=!state.match?.id||state.demo_active;
 $('pattern-return').hidden=!patternReturn||patternReturn.profileId!==state.profile?.id||state.mode!=='lesson';
 $('next-practice').hidden=state.mode!=='lesson';
 const match=state.match,profiles=state.profiles||[];
 for(const [id,mode] of [['mode-lesson','lesson'],['mode-human-ai','human_ai'],['mode-two-player','two_player']]){$(id).classList.toggle('selected',selectedMode===mode);$(id).setAttribute('aria-pressed',String(selectedMode===mode))}
 $('practice-controls').hidden=selectedMode!=='lesson';
 $('match-form').hidden=selectedMode==='lesson';$('human-settings').hidden=selectedMode!=='human_ai';$('two-player-settings').hidden=selectedMode!=='two_player';
 for(const [id,fallback] of [['black-player',0],['white-player',1]]){const selected=$(id).value;$(id).replaceChildren(...profiles.map(p=>{const o=textEl('option',p.name);o.value=p.id;return o}));$(id).value=profiles.some(p=>p.id===selected)?selected:profiles[fallback]?.id||profiles[0]?.id||''}
 $('mode-description').textContent=selectedMode==='lesson'?(state.practice_mode==='sequential'?(state.practice_progress?.book_title?`${state.practice_progress.book_title} · ${state.practice_progress.chapter||sequentialChapter(state.lesson)||''}`:'按三本教材的章节和原题号接续练习。'):state.practice_mode==='review'?'重练还没做对的题。':'按教材主线和练习记录推荐下一题。'):selectedMode==='human_ai'?'电脑自动应手，可随时悔棋。':'黑白轮流落子，对局存入双方档案。';
 if(selectionPending&&selectedMode!=='lesson')$('mode-description').textContent+=' 当前棋盘保持原局，点击“开始新对局”进入所选模式。';
 if(match&&state.mode!=='lesson'){
  const black=match.black?.name||'黑方',white=match.white?.name||'白方';const player=state.to_play===1?black:white;
  $('board-title').textContent=state.demo_active?'看一看这段变化':`${black} · 对 · ${white}`;
  $('board-eyebrow').textContent=`${state.size||9} 路 · ${match.mode==='human_ai'?'人机对弈':'双人对弈'}`;
  $('board-prompt').hidden=false;$('board-prompt').textContent=`黑棋：${black}　白棋：${white}`;
  $('turn-pill').querySelector('span').textContent=state.ended?'本局已结束':`${player} · ${state.to_play===1?'黑':'白'}棋`;
  $('prompt-title').textContent=state.ended?'这一局先下到这里':state.computer_turn?'电脑正在接着想':`轮到${player}落子`;
  $('prompt').textContent=state.ended?'双方连续停一手，本局结束。棋谱已保存；当前版本不自动数目判胜负。':match.mode==='human_ai'?'你下一手，电脑自动应一手。这里会反馈气数、提子等规则事实；它不是完整的棋力评判。':'按黑白轮流落子。双方的对局记录会各自保存，棋盘上方会提示下一位。';
  $('coach-eyebrow').textContent='对局 · 本地规则反馈';
  $('pass').disabled=state.ended||state.demo_active||state.computer_turn;
  $('ai-move').hidden=!state.computer_turn||state.demo_active||state.ended;
  $('ai-move').textContent=busy?'电脑思考中…':aiFailedKey===computerKey()?'重试电脑落子':'电脑准备落子…';
  $('ai-move').disabled=busy||!state.engine?.available;
  if(state.computer_turn&&!inspection)$('inspection').textContent=aiFailedKey===computerKey()?'电脑暂时没有完成落子。可点击“重试电脑落子”，或悔棋后继续。':'现在轮到电脑，落子后会自动回到你。';
 }else if(state.mode==='lesson'){
  const playout=!!state.lesson_playout;$('ai-move').hidden=!playout||!state.computer_turn||state.demo_active||state.ended;$('ai-move').textContent=busy?'陪练思考中…':aiFailedKey===computerKey()?'重试 KataGo 应手':'KataGo 准备落子…';$('ai-move').disabled=busy||!state.engine?.available;$('pass').disabled=!playout||state.ended||state.demo_active||state.computer_turn;
  if(playout){$('coach-eyebrow').textContent='练习续弈 · KataGo 根据当前局面应手';if(state.computer_turn&&!inspection)$('inspection').textContent=aiFailedKey===computerKey()?'陪练暂时没有完成应手，可点击按钮重试。':'现在轮到 KataGo，它落子后你可以继续下。';}
 }
 const backend=state.engine_backend||state.match?.engine_backend;
  $('engine-source').hidden=state.match?.mode!=='human_ai'||!['fnos','vps'].includes(backend);$('engine-source').textContent=backend==='fnos'?'最近一次 AI 落子：fnOS 深度通道':backend==='vps'?'最近一次 AI 落子：VPS 快速通道':'';
 if(cloudMode){const engine=state.engine||{},configured=[];if(engine.primary_configured||engine.fnos_configured)configured.push('fnOS 深度通道已配置');if(engine.fallback_configured||engine.vps_configured)configured.push('VPS 快速通道已配置');$('engine-note').textContent=(configured.length?configured.join(' · ')+'。可用性以实际应手为准。':engine.available?'KataGo 计算服务已配置，可用性以实际应手为准。':'计算服务尚未配置。')+' 做题与双人对弈仍可使用。';}
 else $('engine-note').textContent=state.engine?.available?`KataGo · ${state.engine.status||'已配置'}。人机模式自动应手，双人模式不调用引擎。${state.engine.error?' 引擎提示：'+state.engine.error:''}`:'陪练引擎尚未配置 · 仍可做题与双人对弈。';
 $('matches-title').textContent=`${state.profile?.name||'我'}的对局`;
 const matches=(state.recent_matches||[]).slice(0,5);
 $('matches').replaceChildren(...(matches.length?matches.map(m=>{
  const li=textEl('li'),black=m.players?.black||m.black,white=m.players?.white||m.white;
  li.append(textEl('strong',`${black?.name||'黑方'}（黑）· ${white?.name||'白方'}（白）`));
  const date=new Date(m.updated_at),when=Number.isNaN(date.getTime())?'':date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  li.append(textEl('small',`${m.size||9} 路 · ${m.mode==='human_ai'?'人机':'双人'} · ${m.move_number||0} 手 · ${m.result?({black:'黑方胜',white:'白方胜',draw:'和棋'}[m.result.winner||m.result]||'结果已登记'):m.ended?(cloudMode?'结束 · 结果待确认':'已结束'):'进行中'} · ${when}`));
  const actions=textEl('div','','match-history-actions'),resume=textEl('button',m.ended?'查看棋局':'继续这局','secondary');resume.onclick=()=>act('resume_match',{match_id:m.id});
  const link=textEl('a','导出棋谱');link.href=`/api/sgf?match_id=${encodeURIComponent(m.id)}`;link.download=`${m.id}.sgf`;const review=textEl('button','回看基本棋型','secondary');review.onclick=()=>openMatchPatterns(m.id);actions.append(resume,review,link);li.append(actions);return li;
 }):[textEl('li','开始对弈后，这里会保存你的对局。','empty-history')]));
}
async function openMatchPatterns(matchId){
 const epoch=++patternReviewEpoch,profileId=state?.profile?.id;
 patternWorker?.terminate();patternWorker=null;
 toast('正在回看这盘棋的基本棋型…');
 try{
  const result=await request('/api/match-patterns?match_id='+encodeURIComponent(matchId));
  if(epoch!==patternReviewEpoch||state?.profile?.id!==profileId||result.profile_id!==profileId)return;
  const worker=new Worker('/pattern-worker.js?v=20260912-review');patternWorker=worker;
  const data=await new Promise((resolve,reject)=>{worker.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data);worker.onerror=()=>reject(new Error('棋型回看暂时不可用，请重试。'));worker.postMessage({state:result.state,catalog:lessons,profileId});});
  worker.terminate();if(patternWorker===worker)patternWorker=null;
  if(epoch!==patternReviewEpoch||state?.profile?.id!==profileId)return;
  closeDrawers();window.GoMatchPatterns.open(data,{onPractice:(lessonId,id)=>{patternReturn={matchId:id,profileId};act('lesson',{id:lessonId});},onReturn:id=>act('resume_match',{match_id:id})});
 }catch(error){if(epoch===patternReviewEpoch){patternWorker?.terminate();patternWorker=null;toast(error.message);}}
}
$('review-match-patterns').onclick=()=>{if(state?.match?.id)openMatchPatterns(state.match.id);};
$('return-pattern-match').onclick=()=>{if(patternReturn?.profileId===state?.profile?.id)act('resume_match',{match_id:patternReturn.matchId});};
$('mode-lesson').onclick=()=>selectMode('lesson');$('mode-human-ai').onclick=()=>selectMode('human_ai');$('mode-two-player').onclick=()=>selectMode('two_player');$('match-form').onsubmit=e=>{e.preventDefault();startMatch()};

function renderRating(){
 const rating=state.rating;const match=state.match;const inMatch=state.mode==='free'&&!!match;
 $('rating-title').textContent=`${state.profile?.name||'我'}的练习概览`;
 $('rating-practice').textContent=rating?`练习等级 ${rating.practice_level||1} · ${rating.practice_xp||0} XP（独立完成新题积累）`:'完成练习后逐步积累；此服务暂未提供等级统计。';
 const count=rating?.matches_played||0;const ratingScope=rating?`${rating.summary_size||state.size||9} 路 · ${rating.summary_mode==='human_ai'?'人机':'双人'} · `:'';
 $('rating-summary').textContent=ratingScope+(count?`已确认 ${count} 局 · ${rating.wins||0} 胜 / ${rating.losses||0} 负 / ${rating.draws||0} 和`:'对局样本不足，胜率待评估。');
 $('rating-sizes').replaceChildren(...(rating?.by_size||[]).map(row=>{const line=textEl('p','','quiet');const played=row.matches_played||0;const rate=played?Math.round(100*(row.wins||0)/played):0;line.textContent=`${row.size} 路 · ${row.mode==='human_ai'?'人机':'双人'} · ${played} 局${played?' · 胜率 '+rate+'%':' · 胜率待评估'}${row.rating!==undefined?' · 站内评分 '+Math.round(row.rating)+(row.rated_games<5?'（暂定）':''):''}`;return line}));
 $('rating-note').textContent='练习等级记录独立完成新题的积累，不对应围棋段位。站内评分仅参考同尺寸、双方确认的人类对局；少于 5 局为暂定。人机成绩单列，AI 棋力尚未校准。';
 $('match-result-panel').hidden=!cloudMode||!inMatch;
 const result=match?.result,proposal=match?.result_proposal||match?.proposal;const winnerText=value=>value==='black'?'黑方胜':value==='white'?'白方胜':value==='draw'?'和棋':'待确认';
 $('match-result-status').textContent=result?`已登记结果：${winnerText(result.winner||result)}`:proposal?`待另一位学习者确认：${winnerText(proposal.winner)}`:'当前尚无已确认结果。请核对棋盘后登记。';
 $('propose-result').disabled=!!result;$('resign').disabled=!!result;$('confirm-result').hidden=!proposal||!!result;
}
$('resign').onclick=()=>{$('resign-confirmation').hidden=false};$('cancel-resign').onclick=()=>{$('resign-confirmation').hidden=true};$('confirm-resign').onclick=()=>act('resign');
$('propose-result').onclick=()=>act('propose_result',{winner:$('result-winner').value});$('confirm-result').onclick=()=>act('confirm_result');

function explanationContext(){return state?`${state.profile?.id}:${state.context_key||JSON.stringify([state.match?.id,state.lesson?.id,state.mode,state.move_number,state.lesson_attempted,state.board,state.assessment?.review])}`:null}
function cancelExplanation(){
 clearTimeout(llmAutoTimer);
 const previous=llmRequest;if(!previous)return;
 llmRequest=null;llmBusy=false;llmAutoSeen.delete(previous.key);previous.controller.abort();
}
function renderLLM(){
 if(!state)return;
 const saved=state.llm_explanation;
 const result=llmResult?.profile_id===state.profile?.id&&llmResult.revision===state.revision?llmResult:saved?.profile_id===state.profile?.id&&!saved.stale?saved:null;
 $('explain-indicator').textContent=llmBusy?'正在讲解…':result?'有讲解，展开看':llmError?'讲解未完成':llmSettings.enabled?'可提问':'未启用';
 $('llm-mode').textContent=llmSettings.enabled?`已启用 · ${llmSettings.model||'语言模型'}`:'本地反馈模式';
 $('llm-answer').textContent=result?.text||(llmSettings.enabled?'点击“请老师讲解”才会请求 AI。可以留空讲解当前棋局，也可以输入问题。':'尚未启用语言模型。你可以继续做题，使用本地规则反馈。');
 const error=llmError?.profile_id===state.profile?.id&&llmError.revision===state.revision?llmError:null;
 $('llm-status').textContent=error?`${error.message} 本地规则反馈仍可使用。`:llmBusy?'老师正在组织讲解，你可以继续操作棋盘。':result?`讲解来源：${result.model||'语言模型'} · 请结合棋盘验证`:'仅在你点击后请求讲解，结果会记录到当前学习者的档案。';
 $('llm-retry').hidden=!error;$('llm-retry').disabled=llmBusy||!llmSettings.enabled;
 $('llm-ask').disabled=llmBusy||!llmSettings.enabled;$('llm-ask').textContent=llmBusy?'正在讲解…':'请老师讲解';
 renderBoardChrome();
}
function scheduleExplanation(){
 // AI explanation is exclusively requested by the learner's explicit button click.
 clearTimeout(llmAutoTimer);llmAutoTimer=null;
}
async function explainCurrent(question){
 if(!state||llmBusy||!llmSettings.enabled)return;
 const revision=state.revision,profile_id=state.profile?.id,key=explanationContext();
 const current={key,revision,controller:new AbortController()};llmRequest=current;
 llmAutoSeen.add(key);llmBusy=true;llmError=null;renderLLM();
 try{
  const result=await request('/api/llm/explain',{method:'POST',body:JSON.stringify({revision,trigger:'manual',...(question?{question}:{})}),timeoutMs:45000,signal:current.controller.signal});
  if(llmRequest===current&&state&&!result.stale&&explanationContext()===key&&state.revision===revision&&result.revision===revision&&result.profile_id===profile_id){llmResult=result;$('llm-question').value=''}
 }catch(error){
  if(!error.cancelled&&llmRequest===current&&state&&explanationContext()===key&&state.revision===revision)llmError={revision,profile_id,message:error.status===400?error.message:'这次模型讲解暂时没有完成，请重试。'};
 }finally{
  if(llmRequest===current){llmRequest=null;llmBusy=false;renderLLM()}
 }
}
function fillLLMSettings(){
 $('llm-base').value=llmSettings.base_url||'';$('llm-model').value=llmSettings.model||'';$('llm-enabled').checked=!!llmSettings.enabled;
 $('llm-key').value='';$('llm-key-status').textContent=llmSettings.has_api_key?'已保存密钥，留空可保留；更换服务地址后需重新填写。':'尚未保存 API Key。';renderLLM();
}
async function loadLLMSettings(){try{llmSettings=await request('/api/llm/settings');fillLLMSettings()}catch(error){$('llm-settings-status').textContent='模型设置暂时无法读取；本地练习和对弈仍可用。';renderLLM()}}
function settingsPending(value){llmSettingsBusy=value;$('llm-save').disabled=value;$('llm-test').disabled=value;}
$('llm-question-form').onsubmit=e=>{e.preventDefault();explainCurrent($('llm-question').value.trim())};
$('llm-retry').onclick=()=>explainCurrent($('llm-question').value.trim());
$('llm-settings-form').onsubmit=async e=>{
 e.preventDefault();if(llmSettingsBusy)return;settingsPending(true);$('llm-settings-status').textContent='正在保存…';
 try{llmSettings=await request('/api/llm/settings',{method:'POST',body:JSON.stringify({revision:state?.revision,base_url:$('llm-base').value.trim(),model:$('llm-model').value.trim(),api_key:$('llm-key').value,enabled:$('llm-enabled').checked})});await refresh();fillLLMSettings();llmAutoSeen.clear();llmError=null;$('llm-settings-status').textContent=llmSettings.enabled?'设置已保存，可点击按钮请求 AI 讲解。':'设置已保存，当前使用本地反馈。';}
 catch(error){$('llm-settings-status').textContent='设置未保存，请检查服务地址与模型名后重试。';}
 finally{$('llm-key').value='';settingsPending(false);renderLLM()}
};
$('llm-test').onclick=async()=>{
 if(llmSettingsBusy)return;settingsPending(true);$('llm-settings-status').textContent='正在测试已保存的连接（不发送棋盘）…';
 try{const result=await request('/api/llm/test',{method:'POST',body:'{}',timeoutMs:30000});$('llm-settings-status').textContent=result.ok?'连接测试通过。':'连接测试未通过，请核对已保存的地址、模型和密钥。';}
 catch(error){$('llm-settings-status').textContent='连接测试未完成，请核对已保存的地址、模型和密钥。';}
 finally{settingsPending(false)}
};

let teachingVideos=[],teachingVideosPromise=null,teachingVideosFailed=false,teachingVideosLoaded=false,teachingVideosCheckedAt=0;
const videoTopicNames={liberties:'气与提子',capture:'吃子技巧',escape:'逃子',atari:'打吃',connect:'连接',connection:'连接',cut:'分断',cutting:'分断',eyes:'眼与做活',life_death:'死活',tsumego:'死活',ladder:'征子',net:'枷吃',snapback:'倒扑',ko:'劫',rules:'基本规则',opening:'布局',endgame:'官子',double_atari:'双打吃',gate:'关门吃',connection_trap:'接不归',edge_chase:'边线追吃',life_shapes:'基本死活形',hug:'抱吃',wedge:'挖吃'};
Object.assign(videoTopicNames,{capture_race:'攻杀与对杀',eye_vs_no_eye:'有眼杀无眼',extend_liberties:'延气',squeeze:'滚打包收',golden_rooster:'金鸡独立',rat_steals_oil:'老鼠偷油',big_head_ghost:'大头鬼',under_the_stones:'倒脱靴'});
const chapterVideoConcepts={'二气杀二气':['capture_race'],'二气杀多气':['capture_race','extend_liberties'],'三气杀三气':['capture_race'],'有眼杀无眼':['eye_vs_no_eye'],'实战常形':['capture_race','life_shapes'],'滚打包收':['squeeze'],'金鸡独立':['golden_rooster'],'老鼠偷油':['rat_steals_oil'],'大头鬼':['big_head_ghost'],'倒脱靴':['under_the_stones']};
function videoTags(value){return Array.isArray(value)?value.filter(v=>typeof v==='string'):typeof value==='string'?[value]:[];}
function videoTopics(video){const concepts=videoTags(video.concepts);return concepts.length?concepts:videoTags(video.skills);}
function teachingPlaybackUrl(video){
 try{const url=new URL(video.playback_url,location.origin);return video.playback_url&&url.origin===location.origin&&/^\/api\/videos\/[A-Za-z0-9_-]+\.mp4$/.test(url.pathname)&&!url.search&&!url.hash?url.pathname:null;}catch{return null;}
}
function stopTeachingPlayback(){
 teachingPlaybackEpoch++;teachingPlaybackRequest?.abort();teachingPlaybackRequest=null;teachingPlayback=null;
 const player=$('teaching-video');player.pause();player.removeAttribute('src');player.load();
 $('video-player-retry').hidden=true;
}
function teachingVideoAuthExpired(){
 lockSession();$('login-status').textContent='视频播放需要重新登录，请输入家庭密码后再试。';
}
async function checkTeachingPlayback(url,epoch){
 teachingPlaybackRequest?.abort();const controller=new AbortController();teachingPlaybackRequest=controller;
 try{
  const response=await fetch(url,{method:'HEAD',credentials:'same-origin',cache:'no-store',signal:controller.signal});
  if(epoch!==teachingPlaybackEpoch)return false;
  if(response.status===401){teachingVideoAuthExpired();return false;}
  if(!response.ok){$('video-player-status').textContent=response.status===404?'这段视频暂时不可用，可以查看原网页。':'视频暂时无法加载，请稍后重试或查看原网页。';$('video-player-retry').hidden=false;return false;}
  return true;
 }catch(error){if(epoch===teachingPlaybackEpoch&&error.name!=='AbortError'){$('video-player-status').textContent='视频暂时无法连接，请检查网络后重试。';$('video-player-retry').hidden=false;}return false;}
 finally{if(teachingPlaybackRequest===controller)teachingPlaybackRequest=null;}
}
async function openTeachingVideo(video){
 const url=teachingPlaybackUrl(video);if(!url||!authenticated)return;
 stopTeachingPlayback();teachingPlayback=video;const epoch=teachingPlaybackEpoch;
 $('video-player-title').textContent=video.title;$('video-player-author').textContent=video.author||'教学视频';
 $('video-original-link').href=video.url;$('video-player-status').textContent='正在准备视频…';
 if(!$('video-player-dialog').open)$('video-player-dialog').showModal();document.body.classList.add('drawer-open');
 if(await checkTeachingPlayback(url,epoch)){
  if(epoch!==teachingPlaybackEpoch||!$('video-player-dialog').open)return;
  $('teaching-video').src=url;$('video-player-status').textContent='点击播放器的播放按钮开始观看。';
 }
}
$('video-player-retry').onclick=()=>{if(teachingPlayback)openTeachingVideo(teachingPlayback);};
$('video-player-dialog').addEventListener('cancel',stopTeachingPlayback);
$('video-player-dialog').addEventListener('close',()=>{if(!$('video-player-dialog').open)stopTeachingPlayback();});
$('teaching-video').addEventListener('playing',()=>{$('video-player-status').textContent='';});
$('teaching-video').addEventListener('error',async()=>{
 if(!teachingPlayback||!$('teaching-video').hasAttribute('src'))return;
 const epoch=teachingPlaybackEpoch,url=teachingPlaybackUrl(teachingPlayback);
 if(await checkTeachingPlayback(url,epoch)){
  $('video-player-status').textContent='这段视频暂时无法播放，请重试或查看原网页。';$('video-player-retry').hidden=false;
 }
});
window.addEventListener('pagehide',stopTeachingPlayback);
function videoItem(video){
 const li=textEl('li'),playback=teachingPlaybackUrl(video);
 const seconds=Number(video.duration_seconds),duration=seconds>0?`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`:'时长未提供';
 if(playback){
  const title=textEl('strong',video.title,'video-title'),play=textEl('button','▶ 在 App 内播放','video-play-button');
  play.setAttribute('aria-label',`在 App 内播放：${video.title}`);play.setAttribute('aria-haspopup','dialog');play.setAttribute('aria-controls','video-player-dialog');play.onclick=()=>openTeachingVideo(video);
  li.append(title,textEl('small',`${video.author||'教学视频'} · ${duration}`),play);
 }else{
  const link=textEl('a','到原作者页面观看 ↗','video-source-button');link.href=video.url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.setAttribute('aria-label',`到原作者页面观看：${video.title}`);
  li.append(textEl('strong',video.title,'video-title'),textEl('small',`${video.author||'教学视频'} · ${duration}`),link);
 }
 return li;
}
function renderTeachingVideos(){
 const lesson=state?.lesson,topics=[...videoTags(lesson?.concept),...videoTags(lesson?.concepts)],concepts=new Set((topics.length?topics:lesson?.skill==='tsumego'?['life_shapes','eyes']:[]).flatMap(concept=>chapterVideoConcepts[concept]||[concept]));
 const ranked=teachingVideos.map(video=>({video,score:videoTags(video.concepts).reduce((sum,c)=>sum+(concepts.has(c)?3:0),0)+(videoTags(video.skills).includes(lesson?.skill)?1:0)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
 const related=[],authors=new Set();
 while(ranked.length&&related.length<3){
  // Diversity only breaks relevance ties; a lower score never displaces a higher one.
  const next=ranked.findIndex(item=>item.score===ranked[0].score&&!authors.has(item.video.author||'教学视频'));
  const {video}=ranked.splice(next<0?0:next,1)[0];related.push(video);authors.add(video.author||'教学视频');
 }
 const topic=typeof lesson?.concept==='string'?(chapterVideoConcepts[lesson.concept]?lesson.concept:videoTopicNames[lesson.concept]):null;
 $('lesson-videos').querySelector('summary').textContent=topic?`${topic} · 视频讲解`:'中文视频讲解';
 $('lesson-video-list').replaceChildren(...related.map(videoItem));
 $('lesson-video-status').textContent=teachingVideosFailed?'视频目录暂时无法加载，棋盘练习可继续。':!teachingVideosLoaded?'正在载入视频目录…':!lesson?'可以到题库的“基础视频目录”按主题观看。':related.length?'': '当前题目暂无匹配视频，可到题库查看基础视频目录。';
 renderVideoLibrary();
}
function renderVideoLibrary(){
 const previous=$('video-topic').value,previousAuthor=$('video-author').value,topics=[...new Set(teachingVideos.flatMap(videoTopics))],authors=[...new Set(teachingVideos.map(video=>video.author||'教学视频'))];
 $('video-topic').replaceChildren(...['all',...topics].map(topic=>{const o=textEl('option',topic==='all'?'全部主题':videoTopicNames[topic]||topic);o.value=topic;return o}));
 $('video-topic').value=topics.includes(previous)?previous:'all';
 $('video-author').replaceChildren(...['all',...authors].map(author=>{const o=textEl('option',author==='all'?'全部作者':author);o.value=author;return o}));
 $('video-author').value=authors.includes(previousAuthor)?previousAuthor:'all';
 const selected=$('video-topic').value,author=$('video-author').value,videos=teachingVideos.filter(video=>(selected==='all'||videoTopics(video).includes(selected))&&(author==='all'||(video.author||'教学视频')===author));
 $('video-library-list').replaceChildren(...videos.map(videoItem));
 $('video-library-status').textContent=teachingVideosFailed?'视频目录暂时无法加载，稍后刷新重试。':teachingVideosLoaded?(videos.length?`${videos.length} 条中文视频`:'当前主题与作者组合暂无视频，可切换筛选。'):'正在载入视频目录…';
}
function loadTeachingVideos(refresh=false){
 if(refresh&&Date.now()-teachingVideosCheckedAt>60000)teachingVideosPromise=null;
 if(!teachingVideosPromise){teachingVideosCheckedAt=Date.now();teachingVideosFailed=false;teachingVideosPromise=fetch('/teaching-videos.json',{credentials:'omit',cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('video catalog');return response.json();}).then(data=>{
  const videos=Array.isArray(data)?data:data.videos;if(!Array.isArray(videos))throw new Error('video catalog');
  teachingVideos=videos.filter(video=>{try{const url=new URL(video.url);return !!video.title&&url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}});
 }).catch(()=>{teachingVideosFailed=true;}).finally(()=>{teachingVideosLoaded=true;if(authenticated)renderTeachingVideos();});}
 else renderTeachingVideos();
 return teachingVideosPromise;
}
$('video-topic').onchange=renderVideoLibrary;$('video-author').onchange=renderVideoLibrary;

function reportRenderError(){
 refresh.renderPending=true;
 try{toast('页面显示暂时未完成，正在重试。')}catch{const message=$('message');if(message){message.hidden=false;message.textContent='页面显示暂时未完成，请稍后重试。';}}
}
function resetSessionRecovery(){clearTimeout(sessionRetryTimer);sessionRetryTimer=null;sessionRetryAttempt=0;sessionRequest=null;}
function scheduleSessionRetry(epoch){
 clearTimeout(sessionRetryTimer);sessionRetryTimer=null;
 if(epoch!==authEpoch||authenticated||document.hidden||!navigator.onLine)return;
 const delay=Math.min(30000,1000*2**Math.min(sessionRetryAttempt++,5));
 sessionRetryTimer=setTimeout(()=>{sessionRetryTimer=null;if(epoch===authEpoch&&!authenticated&&!document.hidden&&navigator.onLine)checkSession()},delay);
}
async function init(){
 if(!authenticated)return;
 try{
  loadTeachingVideos();$('login-panel').hidden=true;$('private-app').hidden=false;$('logout').hidden=!cloudMode;$('confirm-enabled').checked=confirmDefault;
  await refresh();if(!authenticated)return;await loadLLMSettings();if(!authenticated)return;
  try{await reloadLessonCatalog(state?.sync?.catalog_revision??null)}catch(error){if(authenticated)toast('练习列表暂时未载入，稍后会自动重试。');return}
 }finally{schedulePoll()}
}
async function checkSession(){
 if(document.hidden||!navigator.onLine)return false;
 if(sessionRequest?.epoch===authEpoch)return sessionRequest;
 clearTimeout(sessionRetryTimer);sessionRetryTimer=null;
 const epoch=authEpoch,pending=(async()=>{
  let response,session;
  try{
   ({response,session}=await timedFetch('/api/session',{cache:'no-store'},12000,async response=>({response,session:response.status===404?null:await response.json()})));
   if(epoch!==authEpoch)return false;
   if(response.status!==404&&(!response.ok||!session||typeof session.cloud!=='boolean'||typeof session.authenticated!=='boolean'))throw transientError('会话服务暂时不可用。','response');
  }catch(error){
   if(epoch!==authEpoch)return false;
   $('login-panel').hidden=false;$('login-status').textContent='暂时无法连接，正在自动重试。';connected(false,{force:!navigator.onLine});scheduleSessionRetry(epoch);return false;
  }
  sessionRetryAttempt=0;
  if(response.status===404){cloudMode=false;authenticated=true;}else{cloudMode=!!session.cloud;authenticated=!!session.authenticated||!cloudMode;}
  connected(true);
  if(authenticated){try{await init()}catch(error){if(epoch===authEpoch)reportRenderError()}}else lockSession();
  return true;
 })();
 pending.epoch=epoch;sessionRequest=pending;try{return await pending}finally{if(sessionRequest===pending)sessionRequest=null}
}
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-submit').disabled=true;$('login-status').textContent='正在登录…';try{const response=await fetch('/api/login',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('family-password').value})});if(!response.ok)throw new Error('密码不正确或请求过于频繁，请稍后重试。');$('family-password').value='';authEpoch++;resetSessionRecovery();authenticated=true;cloudMode=true;await init();$('login-status').textContent='';}catch(error){$('login-status').textContent=navigator.onLine?error.message:'当前离线，联网后继续。';}finally{$('family-password').value='';$('login-submit').disabled=false;}};
$('logout').onclick=async()=>{lockSession();$('login-submit').disabled=true;$('login-status').textContent='正在退出…';try{await fetch('/api/logout',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}'});$('login-status').textContent='已退出。';}catch(error){$('login-status').textContent='页面已锁定。退出请求未送达，请联网后刷新并退出。';}finally{$('login-submit').disabled=false;}};
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(pollTimer);clearTimeout(sessionRetryTimer);sessionRetryTimer=null;}else if(authenticated){lightSync().finally(schedulePoll);loadTeachingVideos(true);}else checkSession();});
function networkState(){$('offline-banner').hidden=navigator.onLine;if(!navigator.onLine){connected(false,{force:true});pendingMove=null;if(state)render();}else if(authenticated)lightSync().finally(schedulePoll);else checkSession();}
window.addEventListener('online',networkState);window.addEventListener('offline',networkState);$('offline-banner').hidden=navigator.onLine;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install-app').hidden=false;});$('install-app').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install-app').hidden=true;}};
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
checkSession();

function renderBoardChrome(){
 document.body.classList.add('session-ready');
 document.querySelector('.board-card').classList.toggle('answer-lesson',state.lesson?.interaction==='choose_answer');
 const board=$('board');
 if(board.dataset.focused==='true'){const [minX,minY,maxX,maxY]=board.dataset.visibleBounds.split(',').map(Number);$('board-eyebrow').textContent=`${state.size} 路 · 局部 ${cols[minX]}${state.size-minY}–${cols[maxX]}${state.size-maxY} · 虚线非边界`;}
 $('current-learner').textContent=state.profile?.name||'学习者';
 const practiceNames={recommended:'智能推荐',sequential:'顺序练习',review:'错题复习'};
 $('current-mode').textContent=state.mode==='lesson'?(practiceNames[state.practice_mode]||'智能推荐'):state.match?.mode==='human_ai'?'人机对弈':state.match?.mode==='two_player'?'双人对弈':'自由对弈';
 const hasFeedback=!$('inline-assessment').hidden;
 const saved=state.llm_explanation;
 const aiReady=!!(llmResult?.profile_id===state.profile?.id&&llmResult.revision===state.revision?llmResult:saved?.profile_id===state.profile?.id&&!saved.stale?saved:null);
 $('open-coach').dataset.aiReady=String(aiReady);
 $('open-coach').textContent=aiReady?'讲解已就绪':llmBusy?'讲解中…':hasFeedback?'讲解 · 有反馈':'讲解';
 $('open-coach').classList.toggle('has-feedback',hasFeedback||aiReady);
 $('open-coach').setAttribute('aria-label',aiReady?'讲解已就绪':hasFeedback?(state.lesson?.interaction==='choose_answer'?'讲解，有新的判断反馈':'讲解，有新的落子反馈'):'打开讲解');
 $('inspection').hidden=false;
 $('pass').hidden=state.mode==='lesson'&&!state.lesson_playout;
}
