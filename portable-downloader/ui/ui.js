'use strict';
const token=location.hash.slice(1);
history.replaceState(null,'',location.pathname);
const q=id=>document.getElementById(id);
let current=null,stopped=false,closingUI=false,clientError=null,qualityStamp='',noticeTimer,pendingJob=null,handoffBusy=false;
const samples={youtube:'https://www.youtube.com/watch?v=jNQXAC9IVRw',facebook:'https://www.facebook.com/cnn/videos/10155529876156509/',bilibili:'https://www.bilibili.com/video/BV1nx411u79K',youtube4k:'https://www.youtube.com/watch?v=aqz-KE-bpKQ'};
async function api(route,body){
  const response=await fetch('/api/'+route,{method:body===undefined?'GET':'POST',headers:{'X-ClipPocket-Token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'操作未完成。');return result;
}
function localError(error){clientError=error.message;q('status').classList.add('error');q('statusText').textContent=error.message;}
function notice(message){clearTimeout(noticeTimer);q('notice').textContent=message;q('notice').hidden=false;noticeTimer=setTimeout(()=>q('notice').hidden=true,5000);}
function formatTime(seconds){if(!seconds)return'長度依來源提供';const n=Math.round(seconds);return Math.floor(n/60)+' 分 '+n%60+' 秒';}
function selectedFormat(){return document.querySelector('input[name=format]:checked').value;}
function renderDelivery(){
  const browser=q('delivery').value==='browser';
  q('folderControls').hidden=browser;q('openFolder').hidden=browser;
  q('download').textContent=browser?'↓　處理並交給瀏覽器儲存':'↓　直接存到指定資料夾';
  q('deliveryHint').textContent=browser?'完成處理後自動交給瀏覽器；儲存位置依瀏覽器設定。若未自動開始，可在最近處理按「再次儲存」。':'完成後直接存到下方資料夾，不經瀏覽器下載管理員。';
}
async function saveInBrowser(file){
  const result=await api('browser-download',{id:file.id});if(stopped||closingUI)return;
  const link=document.createElement('a');link.href=result.url;link.download=result.name;
  document.body.append(link);link.click();link.remove();
  notice('已交給瀏覽器下載管理員；請在瀏覽器下載清單確認儲存進度。');
}
async function handoff(state){
  if(!pendingJob||handoffBusy)return;
  const file=state.files.find(file=>file.jobId===pendingJob&&file.delivery==='browser');
  if(!file){if(!state.busy&&['error','cancelled'].includes(state.phase))pendingJob=null;return;}
  handoffBusy=true;pendingJob=null;
  try{await saveInBrowser(file);}catch(error){localError(error);}finally{handoffBusy=false;}
}
function inputMatches(video){if(!video)return false;try{return new URL(q('url').value.trim()).href===video.url;}catch{return false;}}
function renderQuality(video){
  const matching=inputMatches(video);
  const stamp=matching?video.url+'|'+JSON.stringify(video.qualities):'unloaded';
  if(stamp!==qualityStamp){
    const previous=q('height').value;
    const sameVideo=qualityStamp.startsWith((video?.url||'')+'|');
    qualityStamp=stamp;
    const options=[{id:'best',label:matching?'最佳可用畫質':'最佳可用畫質（讀取資訊後可選）'},...(matching?video.qualities||[]:[])];
    q('height').replaceChildren(...options.map(option=>{const node=document.createElement('option');node.value=option.id;node.textContent=option.label;return node;}));
    q('height').value=sameVideo&&options.some(option=>option.id===previous)?previous:'best';
  }
  q('qualityHint').textContent=matching?video.qualityNotice:'先讀取影片資訊，即可選擇這支影片實際提供的解析度與幀率。';
  const disabled=Boolean(current?.busy||current?.update?.busy)||selectedFormat()==='mp3';q('height').disabled=disabled;q('mode').disabled=disabled;
  q('modeHint').textContent=q('mode').value==='original'?'保留來源編碼，通常不需轉檔；部分播放器可能無法播放。':'必要時轉成 H.264＋AAC，保留所選解析度與幀率；高畫質轉檔較久。';
}
function renderHistory(files){
  const stamp=files.map(file=>file.id).join('|');if(q('history').dataset.stamp===stamp)return;q('history').dataset.stamp=stamp;if(!files.length)return;
  q('history').replaceChildren();
  for(const file of files){
    const item=document.createElement('div');item.className='history-item';
    const title=document.createElement('div');title.className='history-title';title.textContent=file.title;
    const meta=document.createElement('div');meta.className='history-meta';meta.textContent=[file.platform,file.format.toUpperCase(),file.quality,(file.bytes/1024/1024).toFixed(1)+' MB',file.delivery==='browser'?'交給瀏覽器儲存':'已存到指定資料夾'].filter(Boolean).join(' · ');
    const reveal=document.createElement('button');reveal.textContent=file.delivery==='browser'?'再次儲存到瀏覽器 ↓':'在資料夾中顯示 ↗';
    reveal.onclick=async()=>{try{if(file.delivery==='browser')await saveInBrowser(file);else{await api('reveal',{id:file.id});notice('已在檔案總管顯示檔案。');}}catch(error){localError(error);}};
    item.append(title,meta,reveal);q('history').append(item);
  }
}
function render(state){
  current=state;renderUpdate(state);for(const id of ['url','paste','analyze','download','chooseFolder','delivery'])q(id).disabled=state.busy||state.update?.busy;
  document.querySelectorAll('input[name=format], [data-sample]').forEach(el=>el.disabled=state.busy||state.update?.busy);
  q('cancel').hidden=!state.busy;q('status').classList.toggle('error',Boolean(state.error));q('statusText').textContent=state.error||state.message;q('statusDetail').textContent=state.detail||'';
  q('folderPath').textContent=state.folder;q('folderPath').title=state.folder;q('log').textContent=state.log.join('\n');
  q('progressTrack').hidden=!state.busy;q('progressTrack').classList.toggle('indeterminate',state.progress===null);q('progressFill').style.width=(state.progress||0)+'%';
  const showVideo=inputMatches(state.video);q('videoInfo').hidden=!showVideo;
  if(showVideo){
    q('videoTitle').textContent=state.video.title;q('videoPlatform').textContent=state.video.platform;q('videoMeta').textContent=formatTime(state.video.duration)+(state.video.maxHeight?' · 可下載最高 '+state.video.maxHeight+'p':'');
    if(state.video.thumbnail&&q('thumbImg').dataset.url!==state.video.thumbnail){q('thumbImg').dataset.url=state.video.thumbnail;q('thumbImg').hidden=false;q('thumbImg').src=state.video.thumbnail;}
  }
  renderQuality(state.video);renderHistory(state.files);
}
function renderUpdate(state){
  const update=state.update;if(!update)return;
  q('appVersion').textContent='本機版 v'+state.version;
  q('updateTitle').textContent=update.latest?'可更新至 v'+update.latest:'版本更新';
  q('updateMessage').textContent=update.message;
  if(!update.busy&&!update.error&&update.result){q('updateMessage').textContent+=' '+update.result.message;}
  q('updateWarning').hidden=!update.latest||update.phase==='restarting';
  q('checkUpdate').disabled=update.busy||update.phase==='checking';
  q('installUpdate').hidden=!update.latest;q('installUpdate').disabled=update.busy||state.busy||update.phase==='checking';
  q('shutdown').disabled=Boolean(update.busy);
  q('updateProgress').hidden=!['downloading','verifying'].includes(update.phase);
  if(update.progress===null)q('updateProgress').removeAttribute('value');else q('updateProgress').value=update.progress;
  q('updatePanel').classList.toggle('update-available',Boolean(update.latest));
  if(update.phase==='restarting'){stopped=true;document.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);}
}
async function poll(){
  if(stopped)return;
  let state;
  try{state=await api('state');}
  catch{
    if(!stopped&&!closingUI){stopped=true;document.querySelector('main').hidden=true;q('closedPanel').hidden=false;q('closedTitle').textContent='ClipPocket 連線已結束';q('closedMessage').textContent='工具已從其他分頁關閉，或本機程式已停止。';q('closedHint').textContent='可以關閉此分頁。需要使用時，請重新開啟 ClipPocket.exe。';window.scrollTo(0,0);}
    if(!stopped)setTimeout(poll,700);return;
  }
  if(!stopped&&!closingUI){render(state);await handoff(state);if(clientError){q('status').classList.add('error');q('statusText').textContent=clientError;}}
  if(!stopped)setTimeout(poll,700);
}
function changedUrl(){clientError=null;renderQuality(current?.video);q('videoInfo').hidden=!inputMatches(current?.video);}
q('url').oninput=changedUrl;
q('paste').onclick=async()=>{try{q('url').value=await navigator.clipboard.readText();changedUrl();q('url').focus();}catch{q('url').focus();notice('請在網址欄按 Ctrl＋V 貼上。');}};
document.querySelectorAll('[data-sample]').forEach(el=>el.onclick=()=>{q('url').value=samples[el.dataset.sample];changedUrl();api('analyze',{url:q('url').value}).catch(localError);});
q('analyze').onclick=()=>{clientError=null;api('analyze',{url:q('url').value}).catch(localError);};
q('download').onclick=async()=>{
  clientError=null;q('download').disabled=true;
  try{const result=await api('download',{url:q('url').value,format:selectedFormat(),quality:q('height').value,mode:q('mode').value,delivery:q('delivery').value});pendingJob=q('delivery').value==='browser'?result.jobId:null;}
  catch(error){localError(error);q('download').disabled=false;}
};
q('checkUpdate').onclick=()=>api('update-check',{}).catch(error=>notice(error.message));
q('installUpdate').onclick=async()=>{q('installUpdate').disabled=true;try{await api('update-install',{});}catch(error){notice(error.message);q('installUpdate').disabled=false;}};
q('cancel').onclick=()=>api('cancel',{}).catch(localError);
q('chooseFolder').onclick=async()=>{q('chooseFolder').disabled=true;try{await api('folder',{});}catch(error){localError(error);}finally{q('chooseFolder').disabled=false;}};
q('openFolder').onclick=async()=>{try{await api('open-folder',{});notice('已開啟下載資料夾。');}catch(error){localError(error);}};
q('shutdown').onclick=async()=>{
  if(closingUI||stopped)return;
  closingUI=true;q('shutdown').disabled=true;q('shutdown').textContent='正在關閉…';
  try{await api('shutdown',{});}catch(error){closingUI=false;q('shutdown').disabled=false;q('shutdown').textContent='關閉工具';localError(error);notice(error.message);return;}
  stopped=true;pendingJob=null;document.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
  document.querySelector('main').hidden=true;q('closedPanel').hidden=false;window.scrollTo(0,0);q('closedTitle').setAttribute('tabindex','-1');q('closedTitle').focus();
  // The request is an acknowledgement. Wait until the local listener is gone
  // before telling the user that the tool has finished closing.
  const deadline=Date.now()+8000;let disconnected=false;
  while(Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,200));try{const response=await fetch('/health',{cache:'no-store',signal:AbortSignal.timeout(700)});if(!response.ok){disconnected=true;break;}}catch{disconnected=true;break;}}
  q('closedTitle').textContent=disconnected?'ClipPocket 已關閉':'正在結束 ClipPocket';
  q('closedMessage').textContent=disconnected?'本機工具已停止，可以關閉這個分頁。':'關閉請求已送出；若仍有處理程序，請稍候再檢查。';
  q('closedHint').textContent='按 Ctrl＋W 可關閉分頁。下次雙擊 ClipPocket.exe 即可重新使用。';
};
q('thumbImg').onerror=()=>q('thumbImg').hidden=true;
q('mode').onchange=()=>renderQuality(current?.video);
q('delivery').onchange=renderDelivery;
renderDelivery();
document.querySelectorAll('input[name=format]').forEach(el=>el.onchange=()=>{document.querySelectorAll('.format').forEach(label=>label.classList.toggle('active',label.querySelector('input').checked));renderQuality(current?.video);});
if(!token){stopped=true;localError(Error('請雙擊 ClipPocket.exe 開啟完整工具。'));document.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);}else{api('heartbeat',{}).catch(()=>{});setInterval(()=>{if(!stopped)api('heartbeat',{}).catch(()=>{});},15000);poll();}
