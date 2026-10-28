'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const REPO='https://github.com/koviankevin/ClipPocket',API='https://api.github.com/repos/koviankevin/ClipPocket/releases/latest';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function versionParts(value){if(typeof value!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value))throw Error('版本號格式不正確。');return value.split('.').map(Number);}
function newer(a,b){const x=versionParts(a),y=versionParts(b);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
function releaseInfo(release,current){
  if(!release||release.draft!==false||release.prerelease!==false||!release.published_at||!Array.isArray(release.assets))throw Error('沒有可用的正式版本。');
  const version=String(release.tag_name||'').replace(/^v/,'');versionParts(version);
  if(!newer(version,current))return null;
  const names=['ClipPocket-'+version+'-Windows-x64-portable.zip','ClipPocket-Windows-x64-portable.zip'];
  const asset=release.assets.find(x=>names.includes(x.name)&&x.state==='uploaded');
  if(!asset||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>600*1024*1024||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw Error('新版尚未提供可驗證的 Windows 免安裝包。');
  const expected=REPO+'/releases/download/'+encodeURIComponent(release.tag_name)+'/'+encodeURIComponent(asset.name);
  if(asset.browser_download_url!==expected)throw Error('更新來源不正確。');
  return {version,url:expected,sha256:asset.digest.slice(7),bytes:asset.size};
}
async function downloadVerified(info,destination,onProgress=()=>{},fetcher=fetch){
  const response=await fetcher(info.url,{signal:AbortSignal.timeout(20*60*1000),headers:{'User-Agent':'ClipPocket updater'}});
  if(!response.ok||!response.body)throw Error('下載更新失敗（HTTP '+response.status+'）。');
  const hash=crypto.createHash('sha256');let count=0,handle;
  try{handle=await fsp.open(destination,'wx');for await(const chunk of response.body){count+=chunk.length;if(count>info.bytes)throw Error('更新檔案大小不符。');hash.update(chunk);await handle.writeFile(chunk);onProgress(Math.floor(count/info.bytes*100));}
    if(count!==info.bytes||hash.digest('hex')!==info.sha256)throw Error('更新檔案校驗失敗，未更動原有工具。');
  }catch(error){await handle?.close();handle=null;await fsp.rm(destination,{force:true});throw error;}finally{await handle?.close();}
}
class Updates {
  constructor(root,version,{fetcher=fetch}={}){this.root=root;this.version=version;this.fetcher=fetcher;this.info=null;this.lastAttempt=0;this.busy=false;this.state={phase:'idle',current:version,latest:null,progress:null,message:'開啟工具時會自動檢查正式版更新。',error:null,nextCheckAt:0};}
  async check(){
    if(this.busy||this.state.phase==='checking'||Date.now()-this.lastAttempt<15000)return this.state;
    this.lastAttempt=Date.now();this.state.nextCheckAt=this.lastAttempt+15000;this.state.phase='checking';this.state.error=null;this.state.message='正在檢查更新…';
    try{const response=await this.fetcher(API,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/vnd.github+json','User-Agent':'ClipPocket/'+this.version}});if(!response.ok)throw Error('GitHub 暫時無法提供更新資訊（HTTP '+response.status+'），請稍後再試。');
      this.info=releaseInfo(await response.json(),this.version);this.state.latest=this.info?.version||null;this.state.phase=this.info?'available':'current';this.state.message=this.info?'新版 v'+this.info.version+' 已推出。':'目前已是最新正式版本。';this.state.checkedAt=new Date().toISOString();
    }catch(error){this.state.phase=this.info?'available':'error';this.state.error=error.name==='TimeoutError'?'更新檢查逾時，請稍後再試。':error.message;this.state.message=this.state.error;}
    return this.state;
  }
  async install(canInstall,onRestart){
    if(this.busy)throw Error('更新正在進行。');if(this.state.phase==='checking')throw Error('請等待更新檢查完成。');if(!this.info)throw Error('請先檢查是否有新版。');canInstall();
    this.busy=true;this.state.phase='downloading';this.state.error=null;this.state.progress=0;this.state.message='正在下載更新，完成驗證後會自動重開…';
    let temp,helper,handedOff=false;
    try{
      temp=await fsp.mkdtemp(path.join(os.tmpdir(),'ClipPocket-update-'));const archive=path.join(temp,'package.zip');
      await downloadVerified(this.info,archive,p=>this.state.progress=p,this.fetcher);
      this.state.phase='verifying';this.state.progress=null;this.state.message='正在驗證新版檔案，請保持工具開啟…';
      await fsp.copyFile(path.join(this.root,'Updater.exe'),path.join(temp,'Updater.exe'));
      const plan={root:this.root,parentPid:process.pid,parentStarted:Math.floor(performance.timeOrigin),version:this.info.version,sha256:this.info.sha256,bytes:this.info.bytes};
      const planPath=path.join(temp,'plan.json');await fsp.writeFile(planPath,JSON.stringify(plan));
      helper=spawn(path.join(temp,'Updater.exe'),[planPath],{cwd:temp,windowsHide:true,detached:true,stdio:'ignore'});
      let spawnError;helper.on('error',e=>spawnError=e);helper.unref();
      const deadline=Date.now()+300000;
      while(!fs.existsSync(path.join(temp,'ready'))){
        if(spawnError)throw spawnError;
        if(fs.existsSync(path.join(temp,'failed.txt')))throw Error(await fsp.readFile(path.join(temp,'failed.txt'),'utf8'));
        if(helper.exitCode!==null)throw Error('更新程式未能啟動。');
        if(Date.now()>deadline)throw Error('更新程式準備逾時，原版本保持不變。');await delay(200);
      }
      canInstall();this.state.phase='restarting';this.state.message='正在套用更新，完成後會自動開啟新版視窗。此分頁可以關閉。';
      // Leave one poll interval for the old browser to show the restart message.
      await delay(900);await fsp.writeFile(path.join(temp,'go'),'');handedOff=true;await onRestart();
    }catch(error){this.state.phase='available';this.state.error=error.message;this.state.message='更新未完成：'+error.message;}
    finally{if(!handedOff){if(helper?.pid){try{helper.kill();await delay(300);}catch{}}if(temp)await fsp.rm(temp,{recursive:true,force:true}).catch(()=>{});this.busy=false;this.state.progress=null;}}
  }
}
module.exports={Updates,releaseInfo,newer,downloadVerified};
