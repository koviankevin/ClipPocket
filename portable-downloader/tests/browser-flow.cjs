'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process'),execute=require('node:util').promisify(execFile);
const {chromium}=require(process.env.CLIPPOCKET_PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'..'),EVIDENCE=path.join(ROOT,'evidence'),VERSION=require('../version.json').version;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={version:VERSION,testedAt:new Date().toISOString(),checks:[],downloads:[]};
let instance,browser,cachePaths=[];
async function api(route,body,extra={}) {
  const response=await fetch('http://127.0.0.1:'+instance.port+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'X-ClipPocket-Token':instance.token,...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json()};
}
async function waitIdle(timeout=240000) {
  const start=Date.now();
  for(;;){const {data}=await api('state');if(!data.busy){if(data.error)throw Error(data.error+'\n'+data.log.join('\n'));return data;}if(Date.now()-start>timeout)throw Error('Job timeout');await delay(350);}
}
async function validate(file,savedPath) {
  const source=await fsp.readFile(file.path),saved=await fsp.readFile(savedPath);
  assert.deepEqual(saved,source);
  const probe=JSON.parse((await execute(path.join(ROOT,'bin/ffmpeg/ffprobe.exe'),['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate','-of','json',savedPath],{windowsHide:true})).stdout);
  await execute(path.join(ROOT,'bin/ffmpeg/ffmpeg.exe'),['-nostdin','-v','error','-i',savedPath,'-f','null','-'],{windowsHide:true,timeout:120000,maxBuffer:1024*1024});
  report.downloads.push({platform:file.platform,format:file.format,delivery:file.delivery,name:file.name,bytes:saved.length,sha256:crypto.createHash('sha256').update(saved).digest('hex'),browserBytesMatch:'pass',fullDecode:'pass',probe});
  console.log('Verified '+file.platform+' '+file.format+' via '+file.delivery+' ('+saved.length+' bytes)');
}
(async()=>{
  try {instance=JSON.parse(await fsp.readFile(path.join(ROOT,'.instance.json'),'utf8'));const health=await fetch('http://127.0.0.1:'+instance.port+'/health',{signal:AbortSignal.timeout(1000)});if(health.ok){await api('shutdown',{});await delay(1500);}}catch{}
  const launcher=spawn(path.join(ROOT,'ClipPocket.exe'),[],{cwd:ROOT,windowsHide:true,env:{...process.env,CLIPPOCKET_TEST_MODE:'1'},stdio:'ignore'});
  await new Promise((resolve,reject)=>{launcher.on('error',reject);launcher.on('exit',code=>code===0?resolve():reject(Error('Launcher failed')));});
  const start=Date.now();for(;;){try{instance=JSON.parse(await fsp.readFile(path.join(ROOT,'.instance.json'),'utf8'));const r=await fetch('http://127.0.0.1:'+instance.port+'/health',{signal:AbortSignal.timeout(1000)});if((await r.json()).version===VERSION)break;}catch{}if(Date.now()-start>60000)throw Error('Startup timeout');await delay(250);}
  const base='http://127.0.0.1:'+instance.port;
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1380,height:1200}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/#'+instance.token);await page.waitForFunction(()=>document.querySelector('#folderPath').textContent.length>0);
  assert.equal(await page.locator('#delivery').inputValue(),'browser');assert(await page.locator('#folderControls').isHidden());assert(await page.locator('#openFolder').isHidden());
  report.checks.push({name:'Default browser delivery, folder controls hidden',status:'pass'});
  const cases=[{sample:'youtube',format:'mp4'},{sample:'facebook',format:'mp4',resolution:360},{sample:'bilibili',format:'mp4'},{sample:'bilibili',format:'mp3'}];
  for(const [index,item] of cases.entries()) {
    await page.waitForFunction(()=>!document.querySelector('#analyze').disabled);
    await page.locator('[data-sample='+item.sample+']').click();await delay(250);const analyzed=await waitIdle();
    await page.waitForFunction(()=>!document.querySelector('#download').disabled);
    await page.locator('input[name=format][value='+item.format+']').check();
    if(item.format==='mp4')await page.locator('#height').selectOption(item.resolution?analyzed.video.qualities.find(q=>q.resolution===item.resolution).id:'best');
    const event=page.waitForEvent('download',{timeout:240000});await page.locator('#download').click();const download=await event;
    assert.equal(await download.failure(),null);const state=await waitIdle(),file=state.files[0];assert.equal(file.delivery,'browser');
    assert.equal(download.suggestedFilename(),file.name);
    const saved=path.join(EVIDENCE,'browser-'+index+'.'+item.format);await download.saveAs(saved);await validate(file,saved);cachePaths.push(file.path);
    assert(!state.message.includes('已存到'));assert(!file.path.startsWith(state.folder+path.sep));
    if(index===0) {
      // Retrying uses the cached result, without rerunning the extractor.
      await page.waitForFunction(()=>document.querySelector('#history button')?.textContent.includes('再次儲存'));
      const retry=page.waitForEvent('download');await page.locator('#history button').first().click();const second=await retry;
      const secondPath=await second.path();assert.deepEqual(await fsp.readFile(secondPath),await fsp.readFile(file.path));
      // Reloading must not launch old downloads again.
      const reload=await context.newPage();let replay=0;reload.on('download',()=>replay++);
      await reload.goto(base+'/#'+instance.token);await reload.waitForFunction(()=>document.querySelector('#history button')?.textContent.includes('再次儲存'));await delay(1200);assert.equal(replay,0);await reload.close();
      const {data:ticket}=await api('browser-download',{id:file.id});
      let response=await fetch(base+ticket.url,{headers:{Range:'bytes=100-199'}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),(await fsp.readFile(file.path)).subarray(100,200));
      assert.equal((await fetch(base+'/download/no-ticket')).status,404);
      assert.equal((await fetch(base+ticket.url,{headers:{Origin:'https://unrelated.example'}})).status,403);
      assert.equal((await api('browser-download',{id:file.id},{'X-ClipPocket-Token':'wrong'})).status,403);
      assert.equal((await api('browser-download',{id:'../../app.cjs'})).status,400);
      report.checks.push({name:'Browser download event and filename; retry bytes; reload does not replay; range resume; invalid ticket/auth/origin rejected',status:'pass'});
    }
  }
  await page.screenshot({path:path.join(EVIDENCE,'v03-browser.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(EVIDENCE,'v03-narrow.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Existing destination setting remains active and direct mode does not
  // trigger a browser download. Use a real MP3, not a synthetic fixture.
  await page.locator('#delivery').selectOption('folder');assert(await page.locator('#folderControls').isVisible());assert(await page.locator('#openFolder').isVisible());
  await page.locator('[data-sample=youtube]').click();await delay(250);await waitIdle();await page.waitForFunction(()=>!document.querySelector('#download').disabled);
  await page.locator('input[name=format][value=mp3]').check();let unexpected=0;const countDownload=()=>unexpected++;page.on('download',countDownload);
  await page.locator('#download').click();await delay(250);const direct=await waitIdle();assert.equal(direct.files[0].delivery,'folder');assert(direct.files[0].path.startsWith(direct.folder+path.sep));
  await delay(1200);assert.equal(unexpected,0);page.off('download',countDownload);await validate(direct.files[0],direct.files[0].path);
  report.checks.push({name:'Direct folder MP3 preserved, no browser download; responsive layout',status:'pass'});
  assert.equal((await api('download',{url:'https://www.youtube.com/watch?v=jNQXAC9IVRw',delivery:'remote'})).status,400);
  const history=JSON.parse(await fsp.readFile(path.join(ROOT,'data/history.json'),'utf8'));assert(history.every(file=>file.delivery!=='browser'));
  assert.equal(errors.length,0);report.checks.push({name:'Invalid delivery rejected; browser cache excluded from persistent history; no JS errors',status:'pass'});
  await page.locator('#shutdown').click();await page.waitForFunction(()=>document.querySelector('#statusText').textContent.includes('工具已關閉'));await delay(1600);
  for(const cached of cachePaths)assert(!fs.existsSync(cached));assert(fs.existsSync(direct.files[0].path));
  report.checks.push({name:'Shutdown clears browser cache and keeps direct saved file',status:'pass'});
  report.status='pass';console.log('All browser delivery checks passed');
})().catch(error=>{report.status='failed';report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{
  report.finishedAt=new Date().toISOString();await fsp.writeFile(path.join(EVIDENCE,'browser-report.json'),JSON.stringify(report,null,2));
  if(browser)await browser.close();if(instance)try{await api('shutdown',{});}catch{}
});
