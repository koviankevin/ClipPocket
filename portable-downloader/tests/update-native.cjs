'use strict';
// Isolated fixture releases exercise the shipping coordinator, native helper and
// launcher. Nothing is uploaded or added to the public release list.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process'),execute=require('node:util').promisify(execFile);
const ROOT=path.resolve(__dirname,'..'),BASE=path.resolve(ROOT,'../portable-build-cache/native-updater-'+crypto.randomUUID());
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const mock=`'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {Updates}=require('./updates.cjs'),version=require('./version.json').version;
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixture.json')));
const updater=new Updates(__dirname,version,{fetcher:async url=>url.includes('/api.github.com/')?new Response(JSON.stringify(fixture.release)):new Response(require('node:stream').Readable.toWeb(fs.createReadStream(fixture.archive)))});
fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
const server=http.createServer(async(req,res)=>{let result={};try{if(req.url==='/health')result={app:'ClipPocket',version};else if(req.url==='/check'){await updater.check();result=updater.state;}else if(req.url==='/install'){updater.install(()=>{},async()=>{server.close();setTimeout(()=>process.exit(0),100);});}else if(req.url==='/stop'){setTimeout(()=>process.exit(0),100);}else result=updater.state;}catch(e){result={error:e.message};}res.end(JSON.stringify(result));});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(path.join(__dirname,'.instance.json'),JSON.stringify({port:server.address().port,pid:process.pid,started:performance.timeOrigin})));`;
async function put(root,name,data){const p=path.join(root,name);await fsp.mkdir(path.dirname(p),{recursive:true});await fsp.writeFile(p,data);}
async function walk(root,dir=''){let out=[];for(const e of await fsp.readdir(path.join(root,dir),{withFileTypes:true})){const name=dir+e.name;if(e.isDirectory())out.push(...await walk(root,name+'/'));else out.push(name);}return out;}
async function fixture(root,version,failBoot=false){
  for(const [name,data] of Object.entries({'app.cjs':failBoot?'process.exit(1);':mock,'version.json':JSON.stringify({name:'ClipPocket',version,platform:'windows-x64'}),'ui/index.html':'fixture','bin/yt-dlp.exe':'not invoked','bin/ffmpeg/ffmpeg.exe':'not invoked','quality.cjs':'module.exports={};','browser-downloads.cjs':'module.exports={};','使用說明.txt':'update fixture'}))await put(root,name,data);
  for(const name of ['ClipPocket.exe','Updater.exe','updates.cjs','bin/node.exe']){await fsp.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fsp.copyFile(path.join(ROOT,name),path.join(root,name));}
  await manifest(root,version);
}
async function manifest(root,version){const files=[];for(const name of await walk(root)){if(['runtime-manifest.json','fixture.json'].includes(name))continue;const data=await fsp.readFile(path.join(root,name));files.push({path:name,bytes:data.length,sha256:hash(data)});}await put(root,'runtime-manifest.json',JSON.stringify({application:'ClipPocket',version,platform:'windows-x64',files}));}
async function zip(root,file){await execute(process.env.CLIPPOCKET_PWSH||'pwsh',['-NoProfile','-Command','Compress-Archive -LiteralPath $env:CLIPPOCKET_FIXTURE_ROOT -DestinationPath $env:CLIPPOCKET_FIXTURE_ZIP -CompressionLevel Fastest'],{env:{...process.env,CLIPPOCKET_FIXTURE_ROOT:root,CLIPPOCKET_FIXTURE_ZIP:file},windowsHide:true,timeout:120000});}
async function getInstance(root,version){const limit=Date.now()+60000;while(Date.now()<limit){try{const info=JSON.parse(await fsp.readFile(path.join(root,'.instance.json'),'utf8'));const h=await fetch('http://127.0.0.1:'+info.port+'/health',{signal:AbortSignal.timeout(1000)});if((await h.json()).version===version)return info;}catch{}await delay(200);}throw Error('Fixture startup timeout '+version);}
async function request(info,route){return(await fetch('http://127.0.0.1:'+info.port+'/'+route)).json();}
async function runCase(name,failBoot=false,tamper=false,unsafe=false,collision=false){
  const dir=path.join(BASE,name),installed=path.join(dir,'installed'),payload=path.join(dir,'package','ClipPocket'),archive=path.join(dir,'update.zip');
  await fixture(installed,'0.3.0');await fixture(payload,'0.4.0',failBoot);
  // Force a failure after some files were replaced, rather than only preflight.
  if(unsafe){await put(payload,'data/settings.json','must never overwrite');await manifest(payload,'0.4.0');}
  await zip(payload,archive);const data=await fsp.readFile(archive),filename='ClipPocket-0.4.0-Windows-x64-portable.zip';
  const release={tag_name:'v0.4.0',draft:false,prerelease:false,published_at:new Date().toISOString(),assets:[{name:filename,state:'uploaded',size:data.length,digest:'sha256:'+(tamper?'0'.repeat(64):hash(data)),browser_download_url:'https://github.com/koviankevin/ClipPocket/releases/download/v0.4.0/'+filename}]};
  await put(installed,'fixture.json',JSON.stringify({release,archive}));
  const preserved={'data/settings.json':'{"folder":"chosen-folder"}','data/history.json':'[{"title":"keep me"}]','Downloads/keep.mp4':'saved video','notes.txt':'user-created file'};
  if(collision){await put(payload,'Launcher.cs','new managed source');await manifest(payload,'0.4.0');await fsp.unlink(archive);await zip(payload,archive);const updated=await fsp.readFile(archive);release.assets[0].size=updated.length;release.assets[0].digest='sha256:'+hash(updated);await put(installed,'fixture.json',JSON.stringify({release,archive}));preserved['Launcher.cs']='pre-existing personal file';}
  for(const [file,text] of Object.entries(preserved))await put(installed,file,text);
  const child=spawn(path.join(installed,'bin/node.exe'),[path.join(installed,'app.cjs')],{cwd:installed,windowsHide:true,env:{...process.env,CLIPPOCKET_TEST_MODE:'1'},stdio:'ignore'});child.on('error',e=>{throw e;});
  let info;
  try{info=await getInstance(installed,'0.3.0');assert.equal((await request(info,'check')).latest,'0.4.0');await request(info,'install');
    if(tamper||unsafe){const limit=Date.now()+60000;let result;do{await delay(300);result=await request(info,'state');}while(!result.error&&Date.now()<limit);assert.match(result.error,tamper?/校驗失敗/:/Invalid|Unmanaged/);assert.equal((await request(info,'health')).version,'0.3.0');}
    else {const limit=Date.now()+90000;let result;while(Date.now()<limit){try{result=JSON.parse((await fsp.readFile(path.join(installed,'data/update-result.json'),'utf8')).replace(/^\uFEFF/,''));break;}catch{}try{const progress=await request(info,'state');if(progress.error)throw Object.assign(Error(progress.error),{updateFailed:true});}catch(e){if(e.updateFailed)throw e;}await delay(250);}assert.equal(result?.status,failBoot||collision?'rolled-back':'updated');info=await getInstance(installed,failBoot||collision?'0.3.0':'0.4.0');}
    for(const [file,text] of Object.entries(preserved))assert.equal(await fsp.readFile(path.join(installed,file),'utf8'),text,'Preserve '+file);
    console.log('PASS '+name);return{name,status:'pass',preserves:['settings','history','saved videos','user-created files']};
  }finally{if(info)try{await request(info,'stop');}catch{}await delay(350);}
}
(async()=>{await fsp.mkdir(BASE,{recursive:true});const checks=[];for(const item of [['successful update'],['startup failure rollback',true],['tampered download',false,true],['protected ZIP entry',false,false,true],['user file collision',false,false,false,true]])checks.push(await runCase(...item));const report={status:'pass',version:require('../version.json').version,testedAt:new Date().toISOString(),checks};await fsp.writeFile(path.join(ROOT,'evidence/update-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));})().catch(error=>{console.error(error);process.exitCode=1;});
