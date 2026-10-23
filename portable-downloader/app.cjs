'use strict';
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const { qualityOptions, outputRequest, selectQuality }=require('./quality.cjs');
const APP_VERSION=require('./version.json').version;
const {BrowserDownloads,deliveryRequest}=require('./browser-downloads.cjs');
const {Updates}=require('./updates.cjs');
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const ROOT=__dirname;
const BIN=path.join(ROOT,'bin');
const ENGINE=path.join(BIN,'yt-dlp.exe');
const NODE=path.join(BIN,'node.exe');
const FFDIR=path.join(BIN,'ffmpeg');
const FFMPEG=path.join(FFDIR,'ffmpeg.exe');
const FFPROBE=path.join(FFDIR,'ffprobe.exe');
const DATA=path.join(ROOT,'data');
const WORK=path.join(ROOT,'.work');
const INSTANCE=path.join(ROOT,'.instance.json');
const browserDownloads=new BrowserDownloads(DATA);
const NO_OPEN=process.argv.includes('--no-open')||process.env.CLIPPOCKET_TEST_MODE==='1';
const NO_BROWSER=process.argv.includes('--no-browser');
const TOKEN=crypto.randomBytes(32).toString('hex');
let origin='',server,activeProcess=null,cancelled=false,closing=false,ready=NO_OPEN||NO_BROWSER,lastBeat=Date.now(),startedAt=Date.now();
const state={busy:false,phase:'idle',message:'貼上網址，就能開始。',progress:null,detail:'',video:null,files:[],error:null,folder:'',log:[]};
const updates=new Updates(ROOT,APP_VERSION);
// A separate browser profile gives this process ownership of the whole tool
// window. Never attach to, or terminate, the user's personal browser process.
class ToolWindow {
  constructor(){this.profile=path.join(DATA,'window-profile');this.pending=new Map();this.sequence=0;this.downloading=new Set();this.socket=null;this.child=null;this.opening=null;this.mainTarget=null;this.lock=null;}
  async command(method,params={}){
    if(this.socket?.readyState!==WebSocket.OPEN)throw Error('工具視窗尚未準備完成。');
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('工具視窗回應逾時。'));},3000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));});
  }
  async activate(targetId){
    const {windowId}=await this.command('Browser.getWindowForTarget',{targetId});
    await this.command('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
    await this.command('Target.activateTarget',{targetId});
  }
  open(url){if(this.opening)return this.opening;this.opening=this.openInner(url).finally(()=>this.opening=null);return this.opening;}
  async openInner(url){
    if(this.socket?.readyState===WebSocket.OPEN){
      const {targetInfos}=await this.command('Target.getTargets');
      const target=targetInfos.find(t=>t.type==='page'&&t.url.startsWith(origin+'/'));
      this.mainTarget=target?.targetId||(await this.command('Target.createTarget',{url,newWindow:true})).targetId;
      await this.activate(this.mainTarget);return;
    }
    const candidates=[];
    for(const base of [process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean))for(const vendor of ['Microsoft/Edge','Google/Chrome'])candidates.push(path.join(base,vendor,'Application',vendor.includes('Edge')?'msedge.exe':'chrome.exe'));
    this.executable=candidates.find(file=>fs.existsSync(file));
    if(!this.executable)throw Error('專用視窗需要 Microsoft Edge 或 Google Chrome。請安裝其中一個瀏覽器後重新開啟 ClipPocket。');
    await fsp.mkdir(this.profile,{recursive:true});
    const preferences=path.join(this.profile,'Default','Preferences');
    if(!fs.existsSync(preferences)){await fsp.mkdir(path.dirname(preferences),{recursive:true});await fsp.writeFile(preferences,JSON.stringify({signin:{allowed:false,allowed_on_next_startup:false},sync:{requested:false}}),{flag:'wx'});}
    const lockPath=path.join(this.profile,'clippocket-owner.json');
    try{const owner=JSON.parse(await fsp.readFile(lockPath,'utf8'));if(!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('專用視窗的擁有者紀錄無效。');try{process.kill(owner.pid,0);throw Error('專用視窗仍在關閉中，請稍候重新開啟。');}catch(e){if(e.code!=='ESRCH')throw e;}await fsp.unlink(lockPath);}catch(e){if(e.code!=='ENOENT')throw e;}
    this.lock=await fsp.open(lockPath,'wx');await this.lock.writeFile(JSON.stringify({pid:process.pid}));
    await fsp.unlink(path.join(this.profile,'DevToolsActivePort')).catch(e=>{if(e.code!=='ENOENT')throw e;});
    this.child=spawn(this.executable,['--user-data-dir='+this.profile,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-sync','--disable-background-mode','--app='+url],{cwd:ROOT,windowsHide:false,stdio:'ignore'});
    let launchError;this.child.on('error',error=>{launchError=error;});
    const deadline=Date.now()+20000;let endpoint;
    while(Date.now()<deadline){
      // Edge may hand the window to a new browser process and exit with 0.
      // The profile's control endpoint, not the launcher PID, owns its lifetime.
      if(launchError)throw launchError;if(this.child.exitCode!==null&&this.child.exitCode!==0)throw Error('無法開啟專用視窗，請稍候重試。');
      try{const [port,route]=(await fsp.readFile(path.join(this.profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);if(/^\d+$/.test(port)&&Number(port)>0&&Number(port)<=65535&&/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(route)){endpoint='ws://127.0.0.1:'+port+route;break;}}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    if(!endpoint)throw Error('專用視窗啟動逾時，請重新開啟工具。');
    this.socket=new WebSocket(endpoint);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('無法連接專用視窗。')),5000);this.socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});this.socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('無法連接專用視窗。'));},{once:true});});
    this.socket.addEventListener('message',event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      const waiting=this.pending.get(message.id);
      if(waiting){clearTimeout(waiting.timer);this.pending.delete(message.id);if(message.error)waiting.reject(Error(message.error.message));else waiting.resolve(message.result);}
      if(message.method==='Browser.downloadWillBegin')this.downloading.add(message.params.guid);
      if(message.method==='Browser.downloadProgress'&&message.params.state!=='inProgress')this.downloading.delete(message.params.guid);
      if(message.method==='Target.targetDestroyed'&&message.params.targetId===this.mainTarget)this.disconnected();
    });
    this.socket.addEventListener('close',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('工具視窗已結束。'));}this.pending.clear();this.disconnected();});
    const {processInfo}=await this.command('SystemInfo.getProcessInfo');this.browserPid=processInfo.find(p=>p.type==='browser')?.id;
    if(!Number.isInteger(this.browserPid)||this.browserPid<=0)throw Error('無法確認專用視窗程序。');
    this.browserStarted=await this.ownedProcess(false);if(!this.browserStarted)throw Error('專用視窗程序不屬於此工具。');
    await this.command('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:true});
    const {targetInfos}=await this.command('Target.getTargets');this.mainTarget=targetInfos.find(t=>t.type==='page'&&t.url.startsWith(origin+'/'))?.targetId;
    if(!this.mainTarget)throw Error('專用視窗未載入工具畫面。');
    await this.command('Target.setDiscoverTargets',{discover:true});
  }
  disconnected(){this.downloading.clear();if(!closing){windowGone=true;if(!browserDownloads.active)shutdown();}}
  async downloads(){
    const url=path.basename(this.executable).toLowerCase()==='msedge.exe'?'edge://downloads/':'chrome://downloads/';
    const {targetInfos}=await this.command('Target.getTargets');
    const target=targetInfos.find(t=>t.type==='page'&&t.url.startsWith(url));
    const id=target?.targetId||(await this.command('Target.createTarget',{url,newWindow:true})).targetId;
    await this.activate(id);
  }
  async close(){
    if(this.socket?.readyState===WebSocket.OPEN)await this.command('Browser.close').catch(()=>{});
    const alive=()=>{if(!this.browserPid)return false;try{process.kill(this.browserPid,0);return true;}catch{return false;}};
    const end=Date.now()+3000;while(alive()&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
    // The PID comes from the fresh endpoint in our own profile. Recheck its
    // executable and creation time before a kill, including after PID recycling.
    if(alive()&&this.browserStarted)await this.ownedProcess(true);
    this.socket?.close();if(this.lock){await this.lock.close();this.lock=null;await fsp.unlink(path.join(this.profile,'clippocket-owner.json')).catch(()=>{});}
  }
  ownedProcess(terminate){
    const script="$p=Get-Process -Id $env:CLIPPOCKET_WINDOW_PID -ErrorAction SilentlyContinue; if(!$p){exit 0}; $stamp=$p.StartTime.ToUniversalTime().ToString('o'); if($p.Path -ine $env:CLIPPOCKET_WINDOW_EXE){exit 2}; if($env:CLIPPOCKET_WINDOW_KILL -eq '1'){if($stamp -ne $env:CLIPPOCKET_WINDOW_STARTED){exit 3}; & ($env:SystemRoot+'\\System32\\taskkill.exe') /PID $p.Id /T /F | Out-Null; exit $LASTEXITCODE}; [Console]::Write($stamp)";
    return new Promise((resolve,reject)=>{let text='';const p=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,CLIPPOCKET_WINDOW_PID:String(this.browserPid),CLIPPOCKET_WINDOW_EXE:this.executable,CLIPPOCKET_WINDOW_PROFILE:this.profile,CLIPPOCKET_WINDOW_KILL:terminate?'1':'0',CLIPPOCKET_WINDOW_STARTED:this.browserStarted||''},stdio:['ignore','pipe','ignore']});p.stdout.setEncoding('utf8');p.stdout.on('data',x=>text+=x);p.once('error',reject);p.once('exit',code=>code===0?resolve(text.trim()):reject(Error('無法確認專用視窗的程序擁有權。')));});
  }
}
const toolWindow=new ToolWindow();let windowGone=false;
function canUpdate(){if(state.busy||browserDownloads.active||toolWindow.downloading.size)throw Error('請先等待目前工作與瀏覽器儲存完成，再更新工具。');}
for(const dir of [DATA,WORK])fs.mkdirSync(dir,{recursive:true});
try{state.folder=JSON.parse(fs.readFileSync(path.join(DATA,'settings.json'),'utf8')).folder;}catch{}
if(!state.folder||!path.isAbsolute(state.folder))state.folder=path.join(ROOT,'Downloads');
try{const history=JSON.parse(fs.readFileSync(path.join(DATA,'history.json'),'utf8'));if(Array.isArray(history))state.files=history.filter(x=>x&&x.delivery!=='browser'&&typeof x.path==='string'&&typeof x.id==='string').slice(0,20);}catch{}
function log(line){const clean=String(line).replace(/https?:\/\/\S+/g,u=>u.split('?')[0]);state.log.push(clean);if(state.log.length>80)state.log.shift();}
function baseArgs(){return ['--ignore-config','--no-plugin-dirs','--plugin-dirs',path.join(ROOT,'compat'),'--no-playlist','--no-cache-dir','--no-js-runtimes','--js-runtimes','node:'+NODE,'--ffmpeg-location',FFDIR,'--encoding','utf-8','--socket-timeout','25','--retries','2','--extractor-retries','1'];}
function normalizeUrl(raw){if(typeof raw!=='string'||raw.length>2048)throw Error('請貼上影片網址。');let u;try{u=new URL(raw.trim());}catch{throw Error('網址格式不正確。');}if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('請使用一般 HTTPS 影片網址。');const h=u.hostname.toLowerCase();const groups={YouTube:['youtube.com','www.youtube.com','m.youtube.com','youtu.be'],Facebook:['facebook.com','www.facebook.com','m.facebook.com','web.facebook.com','fb.watch'],Bilibili:['bilibili.com','www.bilibili.com','m.bilibili.com','b23.tv']};const platform=Object.keys(groups).find(k=>groups[k].includes(h));if(!platform)throw Error('目前接受 YouTube、Facebook 與 Bilibili 網址。');u.hash='';return{url:u.href,platform};}
function run(exe,args,onLine){return new Promise((resolve,reject)=>{if(cancelled)return reject(Error('已取消下載。'));const proc=spawn(exe,args,{cwd:ROOT,windowsHide:true,shell:false,env:{...process.env,PATH:[BIN,FFDIR,path.join(process.env.SystemRoot||'C:\\Windows','System32')].join(path.delimiter),PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}});activeProcess=proc;let stdout='',stderr='',pending='';proc.stdout.setEncoding('utf8');proc.stderr.setEncoding('utf8');proc.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>8*1024*1024){proc.kill();return;}pending+=chunk;const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines)if(onLine)onLine(line);});proc.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-24000);for(const line of chunk.split(/\r?\n/))if(line)log(line);});proc.on('error',reject);proc.on('close',code=>{if(activeProcess===proc)activeProcess=null;if(pending&&onLine)onLine(pending);if(cancelled)return reject(Error('已取消下載。'));if(code!==0)return reject(Error(stderr.trim()||'處理程序未完成（代碼 '+code+'）。'));resolve({stdout,stderr});});});}
async function extract(raw) {
  const parsed=normalizeUrl(raw);
  const result=await run(ENGINE,[...baseArgs(),'--dump-single-json','--skip-download',parsed.url]);
  let info;
  try { info=JSON.parse(result.stdout); }
  catch { throw Error('無法讀取影片資訊，請換一支公開影片或稍後重試。'); }
  if(info._type==='playlist')throw Error('目前一次處理一支影片，請貼上單支影片網址。');
  if(info.is_live)throw Error('這個驗證版先支援已結束的影片。');
  const qualities=qualityOptions(info);
  let thumbnail=typeof info.thumbnail==='string'?info.thumbnail:null;
  if(thumbnail&&thumbnail.startsWith('http:'))thumbnail='https:'+thumbnail.slice(5);
  return {raw:info,video:{
    id:String(info.id),url:parsed.url,platform:parsed.platform,
    title:info.title||'未命名影片',duration:info.duration||null,
    thumbnail:thumbnail&&thumbnail.startsWith('https:')?thumbnail:null,
    maxHeight:qualities[0]?.resolution||0,qualities,
    qualityNotice:parsed.platform==='Bilibili'
      ?'僅列出目前免登入可取得的畫質；部分高畫質可能受平台帳號權限限制。'
      :'僅列出這支影片實際可下載的畫質，不會放大原片。'
  }};
}
function errorText(error){const text=String(error.message||error);if(cancelled||text.includes('已取消'))return'已取消，未完成的暫存檔會清除。';if(/sign in|login|log in|cookies|private|members.only/i.test(text))return'這支影片目前要求登入或驗證；這個版本不讀取帳號 Cookie。請改用公開、免登入影片。';if(/unsupported url/i.test(text))return'下載引擎暫不支援這種網址，請改貼單支影片的完整連結。';if(/not available|unavailable|not found|removed|no video formats/i.test(text))return'目前無法取得這支影片；可能已下架、受限，或平台已改版。';return text.replace(/https?:\/\/\S+/g,u=>u.split('?')[0]).slice(-1200);}
async function task(phase,fn){if(state.busy)throw Error('請先等待目前工作完成，或按取消。');cancelled=false;state.busy=true;state.phase=phase;state.error=null;state.progress=null;state.detail='';state.log=[];try{await fn();if(!cancelled){state.phase='done';}}catch(error){state.error=errorText(error);state.message=cancelled?'已取消':'這次沒有完成';state.phase=cancelled?'cancelled':'error';log(error.message);}finally{state.busy=false;activeProcess=null;state.progress=null;}}
async function analyze(url){return task('analyzing',async()=>{state.video=null;state.message='正在讀取影片資訊…';const result=await extract(url);state.video=result.video;state.message='已找到影片，可以選擇格式與畫質下載。';});}
function safeName(value){return String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,90)||'video';}
async function availablePath(folder,name,ext){let candidate=path.join(folder,name+ext),n=2;while(fs.existsSync(candidate)){candidate=path.join(folder,name+' ('+String(n++)+')'+ext);}return candidate;}
async function removeWork(dir){const resolved=path.resolve(dir);if(!resolved.startsWith(path.resolve(WORK)+path.sep))throw Error('Refusing cleanup outside task directory');await fsp.rm(resolved,{recursive:true,force:true});}
async function download(input,jobId) {
  const parsed=normalizeUrl(input.url);
  const request=outputRequest(input);
  const delivery=deliveryRequest(input);
  return task('downloading',async()=>{
    let job;
    try {
      state.message='正在確認影片資訊…';
      const {video,raw}=await extract(parsed.url);
      state.video=video;
      const selection=request.format==='mp4'?selectQuality(raw,request):null;
      if(delivery==='folder')await fsp.mkdir(state.folder,{recursive:true});
      job=path.join(WORK,crypto.randomUUID());
      await fsp.mkdir(job);
      state.message=delivery==='browser'?'正在取得影片，處理完成後會交給瀏覽器儲存…':'下載中，檔案會直接存到指定資料夾。';
      const args=[...baseArgs(),'--newline','--progress','--progress-delta','0.5',
        '--progress-template','download:CLIP_PROGRESS %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
        '--no-mtime','-o',path.join(job,'source.%(ext)s')];
      if(request.format==='mp3')args.push('-f','ba/b','-x','--audio-format','mp3','--audio-quality','192K');
      else args.push('-f',selection.selector,'--merge-output-format','mp4','--remux-video','mp4');
      args.push(parsed.url);
      await run(ENGINE,args,line=>{
        if(line.startsWith('CLIP_PROGRESS ')){
          const [percent,speed,eta]=line.slice(14).split('|');
          const value=parseFloat(percent);
          state.progress=Number.isFinite(value)?Math.min(85,value*.85):null;
          state.detail=[selection?.option.label,speed&&speed.trim(),'剩餘 '+(eta||'').trim()].filter(Boolean).join(' · ');
        }else{
          log(line);
          if(/Merger|ExtractAudio|VideoRemuxer/.test(line)){
            state.message=request.format==='mp3'?'正在轉成 MP3…':'正在合併影音…';
            state.phase='processing';
          }
        }
      });
      const source=path.join(job,'source.'+request.format);
      if(!fs.existsSync(source))throw Error('下載程序結束，但未產生預期檔案。');
      let ready=source;
      const probe=JSON.parse((await run(FFPROBE,['-v','error','-show_streams','-show_format','-of','json',source])).stdout);
      const videoStream=probe.streams.find(s=>s.codec_type==='video');
      const audioStream=probe.streams.find(s=>s.codec_type==='audio');
      if(request.format==='mp4'){
        if(!videoStream)throw Error('沒有取得影片畫面。');
        if(request.mode==='compatible'&&(videoStream.codec_name!=='h264'||(audioStream&&audioStream.codec_name!=='aac'))){
          state.phase='processing';
          state.message='正在轉成相容 MP4，保留所選解析度與幀率…';
          state.progress=86;
          ready=path.join(job,'compatible.mp4');
          const duration=Number(probe.format.duration)||video.duration||0;
          await run(FFMPEG,['-nostdin','-hide_banner','-loglevel','error','-y','-i',source,
            '-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','22',
            '-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-progress','pipe:1',ready],line=>{
              if(line.startsWith('out_time_us=')&&duration)state.progress=Math.min(99,86+Number(line.split('=')[1])/1e6/duration*13);
            });
        }
      }
      if(cancelled)throw Error('已取消下載。');
      const fileId=crypto.randomUUID();
      const name=safeName(video.title)+' ['+safeName(video.id)+'].'+request.format;
      const final=delivery==='browser'?browserDownloads.target(fileId,request.format):await availablePath(state.folder,safeName(video.title)+' ['+safeName(video.id)+']','.'+request.format);
      try{await fsp.rename(ready,final);}
      catch(error){if(error.code!=='EXDEV')throw error;await fsp.copyFile(ready,final,fs.constants.COPYFILE_EXCL);await fsp.unlink(ready);}
      const file={id:fileId,jobId,delivery,title:video.title,platform:video.platform,format:request.format,
        quality:selection?.option.label||null,mode:request.mode,path:final,name:delivery==='browser'?name:path.basename(final),
        bytes:(await fsp.stat(final)).size,createdAt:new Date().toISOString()};
      if(delivery==='browser')browserDownloads.register(file);
      state.files.unshift(file);
      state.files=state.files.slice(0,20);
      await fsp.writeFile(path.join(DATA,'history.json'),JSON.stringify(state.files.filter(file=>file.delivery!=='browser'),null,2));
      state.message=delivery==='browser'?'影片已處理完成，可交給瀏覽器下載管理員儲存。':'下載完成，已存到指定資料夾。';
      state.detail=file.name;
      state.progress=100;
    }finally{if(job)await removeWork(job);}
  });
}
function stopChild(){cancelled=true;const proc=activeProcess;if(proc&&proc.pid){spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(proc.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}}
function openPath(args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(process.env.SystemRoot||'C:\\Windows','explorer.exe'),args,
      {windowsHide:false,detached:true,stdio:'ignore'});
    child.once('error',()=>reject(Error('無法啟動檔案總管，請複製儲存路徑手動開啟。')));
    child.once('spawn',()=>{child.unref();resolve();});
  });
}
async function chooseFolder(){if(state.busy)throw Error('工作進行中，請完成後再切換資料夾。');const script="Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='選擇影片下載資料夾'; $d.SelectedPath=$env.CLIPPOCKET_FOLDER; if($d.ShowDialog() -eq 'OK'){ [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::Write($d.SelectedPath) }";const result=await new Promise((resolve,reject)=>{const child=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-STA','-Command',script],{windowsHide:true,env:{...process.env,CLIPPOCKET_FOLDER:state.folder},stdio:['ignore','pipe','pipe']});let text='';child.stdout.setEncoding('utf8');child.stdout.on('data',x=>text+=x);child.on('error',reject);child.on('close',code=>code===0?resolve(text.trim()):reject(Error('無法開啟資料夾選擇視窗。')));});if(result&&path.isAbsolute(result)){state.folder=result;await fsp.writeFile(path.join(DATA,'settings.json'),JSON.stringify({folder:result}));}return{folder:state.folder};}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function readBody(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw Error('請求過大。');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Error('請求格式不正確。');}}
async function handle(req,res) {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  try {
    const url=new URL(req.url,origin);
    if(req.headers.host!==new URL(origin).host)return json(res,403,{error:'無效的本機連線。'});
    if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'拒絕其他網站的請求。'});
    if(url.pathname==='/health'&&req.method==='GET')return json(res,ready?200:503,{app:'ClipPocket',version:APP_VERSION});
    if(url.pathname.startsWith('/download/')){if(updates.busy)return json(res,409,{error:'工具正在更新，請等重開後再下載。'});return await browserDownloads.serve(req,res,url.pathname.slice(10));}
    if(url.pathname.startsWith('/api/')) {
      if(req.headers['x-clippocket-token']!==TOKEN)return json(res,403,{error:'請由工具開啟的視窗操作。'});
      if(req.method==='GET'&&url.pathname==='/api/state'){
        let updateResult=null;try{updateResult=JSON.parse(fs.readFileSync(path.join(DATA,'update-result.json'),'utf8').replace(/^\uFEFF/,''));}catch{}
        return json(res,200,{...state,version:APP_VERSION,windowMode:toolWindow.child?'managed':'browser',update:{...updates.state,busy:updates.busy,result:updateResult}});
      }
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{error:'請使用 JSON 請求。'});
      const body=await readBody(req);
      if(updates.busy&&url.pathname!=='/api/heartbeat')throw Error('工具正在更新，請等待完成後自動重開。');
      switch(url.pathname) {
        case '/api/show-window':await toolWindow.open(origin+'/#'+TOKEN);return json(res,200,{ok:true});
        case '/api/downloads':if(!toolWindow.child)throw Error('請在瀏覽器下載清單查看。');await toolWindow.downloads();return json(res,200,{ok:true});
        case '/api/update-check':updates.check().catch(e=>log(e.message));return json(res,202,{ok:true});
        case '/api/update-install':canUpdate();if(!updates.info)throw Error('請先檢查是否有新版。');updates.install(canUpdate,shutdown).catch(e=>log(e.message));return json(res,202,{ok:true});
        case '/api/heartbeat':lastBeat=Date.now();return json(res,200,{ok:true});
        case '/api/analyze':
          if(state.busy)throw Error('目前有工作進行中。');
          normalizeUrl(body.url);analyze(body.url).catch(e=>log(e.message));return json(res,202,{ok:true});
        case '/api/download': {
          if(state.busy)throw Error('目前有工作進行中。');
          normalizeUrl(body.url);outputRequest(body);deliveryRequest(body);
          const jobId=crypto.randomUUID();
          download(body,jobId).catch(e=>log(e.message));return json(res,202,{ok:true,jobId});
        }
        case '/api/browser-download':return json(res,200,browserDownloads.issue(body.id));
        case '/api/cancel':stopChild();return json(res,200,{ok:true});
        case '/api/folder':return json(res,200,await chooseFolder());
        case '/api/open-folder':
          await fsp.mkdir(state.folder,{recursive:true});await openPath([state.folder]);return json(res,200,{ok:true});
        case '/api/reveal': {
          const file=state.files.find(f=>f.id===body.id);
          if(file?.delivery==='browser')throw Error('儲存位置由瀏覽器管理，請在瀏覽器下載清單查看。');
          if(!file||!fs.existsSync(file.path))throw Error('檔案已移動或不存在。');
          await openPath(['/select,',file.path]);return json(res,200,{ok:true});
        }
        case '/api/shutdown':
          if(browserDownloads.active||toolWindow.downloading.size)throw Error('瀏覽器仍在接收檔案，請等傳送完成後再關閉工具。');
          json(res,200,{ok:true});return setTimeout(shutdown,150);
        default:return json(res,404,{error:'Not found'});
      }
    }
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
    const assets={'/':['index.html','text/html; charset=utf-8'],'/ui.js':['ui.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
    if(!assets[url.pathname])return json(res,404,{error:'Not found'});
    const [file,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});
    res.end(await fsp.readFile(path.join(ROOT,'ui',file)));
  }catch(error) {
    if(!res.headersSent)json(res,400,{error:error.message});else res.destroy(error);
  }
}
async function shutdown(){if(closing||browserDownloads.active)return;closing=true;stopChild();await browserDownloads.close().catch(e=>log(e.message));try{const record=JSON.parse(await fsp.readFile(INSTANCE,'utf8'));if(record.pid===process.pid)await fsp.unlink(INSTANCE);}catch{}if(server)server.close();await toolWindow.close().catch(e=>log(e.message));setTimeout(()=>process.exit(0),1200).unref();}
async function main(){
for(const file of [ENGINE,NODE,FFMPEG,FFPROBE])if(!fs.existsSync(file))throw Error('缺少必要檔案：'+file+'。請完整解壓縮整個工具資料夾。');
if(!NO_OPEN){
  let existing;
  try{const old=JSON.parse(fs.readFileSync(INSTANCE,'utf8'));if(Number.isInteger(old.port)&&old.port>0&&old.port<=65535&&typeof old.token==='string'){const oldOrigin='http://127.0.0.1:'+old.port;const response=await fetch(oldOrigin+'/health',{signal:AbortSignal.timeout(1000)});const health=await response.json();if(health.app==='ClipPocket'&&health.version===APP_VERSION)existing={old,oldOrigin};}}catch{}
  if(existing){if(!NO_BROWSER){const {old,oldOrigin}=existing;const shown=await fetch(oldOrigin+'/api/show-window',{method:'POST',headers:{'X-ClipPocket-Token':old.token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});if(!shown.ok)throw Error((await shown.json()).error||'無法顯示已開啟的工具視窗。');}return;}
}
await browserDownloads.prepare();
server=http.createServer(handle);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;await fsp.writeFile(INSTANCE,JSON.stringify({pid:process.pid,port:server.address().port,token:TOKEN}),{mode:0o600});if(!NO_OPEN&&!NO_BROWSER)await toolWindow.open(origin+'/#'+TOKEN);ready=true;console.log('ClipPocket ready at '+origin);if(!NO_OPEN){updates.check();setInterval(()=>updates.check(),6*60*60*1000).unref();}setInterval(()=>{if(windowGone&&!browserDownloads.active)shutdown();if(!NO_OPEN&&!toolWindow.child&&!state.busy&&!updates.busy&&!browserDownloads.active&&Date.now()-lastBeat>180000&&Date.now()-startedAt>180000)shutdown();},1000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);process.on('uncaughtException',error=>{try{fs.writeFileSync(path.join(DATA,'startup-error.txt'),error.stack||String(error));}catch{}shutdown();});main().catch(async error=>{console.error(error.message);fs.writeFileSync(path.join(DATA,'startup-error.txt'),error.stack||String(error));process.exitCode=1;await shutdown();});
