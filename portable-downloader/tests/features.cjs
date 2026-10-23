'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');const execute=require('node:util').promisify(execFile);
const {chromium}=require(process.env.CLIPPOCKET_PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'..'),EVIDENCE=path.join(ROOT,'evidence');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let instance,browser;
const RESUME=process.argv.includes('--resume-ui');
const report=RESUME?JSON.parse(fs.readFileSync(path.join(EVIDENCE,'feature-report.json'),'utf8')):{version:'0.2.0',testedAt:new Date().toISOString(),environment:'Windows x64, fresh Edge, bundled runtimes, no account cookies',checks:[],downloads:[],qualities:{}};
if(RESUME){assert.equal(report.downloads.length,4);for(const file of report.downloads){assert.equal(file.fullDecode,'pass');assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'Downloads',file.fileName))).digest('hex'),file.sha256);}report.checks=[];report.uiRetestedAt=new Date().toISOString();delete report.error;}
async function api(route,body){const response=await fetch('http://127.0.0.1:'+instance.port+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'X-ClipPocket-Token':instance.token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json()};}
async function idle(timeout=240000){const started=Date.now();for(;;){const {data}=await api('state');if(!data.busy){if(data.error)throw Error(data.error+'\n'+data.log.join('\n'));return data;}if(Date.now()-started>timeout)throw Error('Task timeout');await delay(400);}}
async function validate(file){const probe=JSON.parse((await execute(path.join(ROOT,'bin/ffmpeg/ffprobe.exe'),['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,bit_rate','-of','json',file.path],{windowsHide:true})).stdout);await execute(path.join(ROOT,'bin/ffmpeg/ffmpeg.exe'),['-nostdin','-v','error','-i',file.path,'-f','null','-'],{windowsHide:true,timeout:120000,maxBuffer:1024*1024});report.downloads.push({platform:file.platform,format:file.format,quality:file.quality,mode:file.mode,fileName:file.name,bytes:file.bytes,sha256:crypto.createHash('sha256').update(await fsp.readFile(file.path)).digest('hex'),probe,fullDecode:'pass'});console.log('Verified '+file.platform+' '+file.format+' '+(file.quality||'')+' '+file.bytes+' bytes');return probe;}
(async()=>{
  try{instance=JSON.parse(await fsp.readFile(path.join(ROOT,'.instance.json'),'utf8'));await api('shutdown',{});await delay(1500);}catch{}
  const child=spawn(path.join(ROOT,'ClipPocket.exe'),[],{cwd:ROOT,windowsHide:true,env:{...process.env,CLIPPOCKET_TEST_MODE:'1'},stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Launcher failed')));});
  const start=Date.now();for(;;){try{instance=JSON.parse(await fsp.readFile(path.join(ROOT,'.instance.json'),'utf8'));if((await fetch('http://127.0.0.1:'+instance.port+'/health',{signal:AbortSignal.timeout(1200)})).ok)break;}catch{}if(Date.now()-start>60000)throw Error('Startup timeout');await delay(200);}
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1380,height:1150}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+instance.port+'/#'+instance.token);
  await page.waitForFunction(()=>document.querySelector('#folderPath').textContent.length>0);
  await page.locator('#delivery').selectOption('folder');
  report.uiVersion=require('../version.json').version;
  async function sample(name){await page.waitForFunction(()=>!document.querySelector('#analyze').disabled);await page.locator('[data-sample='+name+']').click();await delay(250);const state=await idle();await page.waitForFunction(()=>!document.querySelector('#download').disabled);report.qualities[name]=state.video.qualities;return state;}
  async function download(format,quality='best',mode='compatible'){
    await page.locator('input[name=format][value='+format+']').check();
    if(format==='mp4'){await page.locator('#height').selectOption(quality);await page.locator('#mode').selectOption(mode);}
    await page.locator('#download').click();await delay(250);const state=await idle();await page.waitForFunction(()=>!document.querySelector('#download').disabled);return validate(state.files[0]);
  }
  let state;
  if(!RESUME){state=await sample('bilibili');assert.equal(state.video.platform,'Bilibili');assert(state.video.qualities.length>0);
  let probe=await download('mp4');assert(probe.streams.some(s=>s.codec_type==='video'&&s.codec_name==='h264'));assert(Number(probe.format.duration)>79);
  probe=await download('mp3');assert(probe.streams.some(s=>s.codec_name==='mp3'));assert(!probe.streams.some(s=>s.codec_type==='video'));
  await sample('youtube');probe=await download('mp4');assert(probe.streams.some(s=>s.codec_name==='h264'&&s.height===240));
  state=await sample('facebook');const fbChoice=state.video.qualities.find(q=>q.resolution===360);assert(fbChoice);probe=await download('mp4',fbChoice.id);assert(probe.streams.some(s=>s.codec_type==='video'&&Math.min(s.width,s.height)===360));
  }
  state=await sample('youtube4k');const list=state.video.qualities;for(const resolution of [144,240,360,480,720,1080,1440,2160])assert(list.some(q=>q.resolution===resolution));assert(list.some(q=>q.resolution===2160&&q.fps===60));
  await page.locator('#height').selectOption('q-2160-60');await page.locator('#mode').selectOption('original');await delay(1600);assert.equal(await page.locator('#height').inputValue(),'q-2160-60');
  await page.screenshot({path:path.join(EVIDENCE,'v02-4k-options.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(EVIDENCE,'v02-narrow.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('input[name=format][value=mp3]').check();assert(await page.locator('#height').isDisabled());assert(await page.locator('#mode').isDisabled());
  await page.locator('input[name=format][value=mp4]').check();await page.locator('#url').fill('https://www.youtube.com/watch?v=jNQXAC9IVRw');await delay(800);assert.deepEqual(await page.locator('#height option').evaluateAll(options=>options.map(o=>o.value)),['best']);
  report.checks.push({name:'Source resolutions/FPS through 4K60, selection persists, changing URL clears stale quality, MP3 disables video controls, narrow layout',status:'pass'});
  const openFolder=(await execute('pwsh.exe',['-NoProfile','-File',path.join(ROOT,'tests/folder-window.ps1')],{windowsHide:true,timeout:30000})).stdout;assert(openFolder.includes('"status": "pass"'));report.checks.push({name:'Open-folder API creates a visible Explorer window',status:'pass'});
  assert.equal((await api('download',{url:'https://www.youtube.com/watch?v=jNQXAC9IVRw',format:'mp4',quality:'q-2160-60;exec'})).status,400);
  const count=(await api('state')).data.files.length;assert.equal((await api('download',{url:'https://www.youtube.com/watch?v=jNQXAC9IVRw',format:'mp4',quality:'best'})).status,202);await api('cancel',{});
  const cancelledAt=Date.now();for(;;){state=(await api('state')).data;if(!state.busy)break;if(Date.now()-cancelledAt>20000)throw Error('Cancel timeout');await delay(250);}assert.equal(state.phase,'cancelled');assert.equal(state.files.length,count);
  report.checks.push({name:'Invalid quality rejected; cancellation still works',status:'pass'});assert.equal(errors.length,0);report.checks.push({name:'No browser JavaScript errors',status:'pass'});
  report.status='pass';report.finishedAt=new Date().toISOString();console.log('All v0.2 integration checks passed');
})().catch(error=>{report.status='failed';report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{await fsp.writeFile(path.join(EVIDENCE,'feature-report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();if(instance)try{await api('shutdown',{});}catch{}});
