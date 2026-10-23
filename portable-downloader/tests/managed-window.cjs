'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.CLIPPOCKET_PLAYWRIGHT_MODULE||'playwright');
const SOURCE=path.resolve(__dirname,'..'),VERSION=require('../version.json').version;
const FIXTURE=path.resolve(SOURCE,'../portable-build-cache/managed-window-'+crypto.randomUUID());
const delay=ms=>new Promise(r=>setTimeout(r,ms));let child,instance,browser,unrelated;const report={version:VERSION,checks:[]};
async function waitFor(fn,ms=30000){const end=Date.now()+ms;while(Date.now()<end){const result=await fn();if(result)return result;await delay(100);}throw Error('Timed out');}
async function linkTree(from,to){await fsp.mkdir(to,{recursive:true});for(const entry of await fsp.readdir(from,{withFileTypes:true})){const a=path.join(from,entry.name),b=path.join(to,entry.name);if(entry.isDirectory())await linkTree(a,b);else await fsp.link(a,b);}}
async function api(route,body){const r=await fetch('http://127.0.0.1:'+instance.port+'/api/'+route,{method:body?'POST':'GET',headers:{'X-ClipPocket-Token':instance.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};}
async function boot(){
 const env={...process.env};delete env.CLIPPOCKET_TEST_MODE;
 child=spawn(path.join(FIXTURE,'bin/node.exe'),[path.join(FIXTURE,'app.cjs')],{cwd:FIXTURE,env,windowsHide:true,stdio:['ignore','ignore','pipe']});child.stderr.on('data',x=>process.stderr.write(x));
 await waitFor(async()=>{try{const i=JSON.parse(await fsp.readFile(path.join(FIXTURE,'.instance.json'),'utf8'));if(i.pid===child.pid){instance=i;const health=await fetch('http://127.0.0.1:'+i.port+'/health');return health.ok&&(await api('state')).data.windowMode==='managed';}}catch{}if(child.exitCode!==null)throw Error('App exited: '+await fsp.readFile(path.join(FIXTURE,'data/startup-error.txt'),'utf8').catch(()=>child.exitCode));});
 const port=await waitFor(async()=>{try{return Number((await fsp.readFile(path.join(FIXTURE,'data/window-profile/DevToolsActivePort'),'utf8')).split(/\r?\n/)[0]);}catch{}});
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
 const page=await waitFor(()=>browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:'+instance.port+'/')));
 await page.waitForFunction(()=>document.querySelector('#folderPath')?.textContent.length>0);return page;
}
async function gone(){await waitFor(()=>child.exitCode!==null,15000);let dead=false;try{await fetch('http://127.0.0.1:'+instance.port+'/health',{signal:AbortSignal.timeout(500)});}catch{dead=true;}assert(dead,'Local listener remained open');assert(!fs.existsSync(path.join(FIXTURE,'data/window-profile/clippocket-owner.json')),'Profile lock was not released');}
(async()=>{
 try{
  await fsp.mkdir(FIXTURE,{recursive:true});for(const name of ['app.cjs','quality.cjs','browser-downloads.cjs','updates.cjs','version.json'])await fsp.copyFile(path.join(SOURCE,name),path.join(FIXTURE,name));await fsp.cp(path.join(SOURCE,'ui'),path.join(FIXTURE,'ui'),{recursive:true});await fsp.cp(path.join(SOURCE,'compat'),path.join(FIXTURE,'compat'),{recursive:true});await linkTree(path.join(SOURCE,'bin'),path.join(FIXTURE,'bin'));
  unrelated=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const personal=await unrelated.newPage();await personal.setContent('<p>Unrelated browser must remain open</p>');
  const page=await boot();console.log('Managed window ready');const context=browser.contexts()[0];let disconnected=false;browser.on('disconnected',()=>disconnected=true);
  assert(await page.locator('#downloads').isVisible());
  // A repeated launch must focus the existing owned window, not create another
  // local server or send the tool URL to the user's normal browser.
  const second=spawn(path.join(FIXTURE,'bin/node.exe'),[path.join(FIXTURE,'app.cjs')],{cwd:FIXTURE,env:{...process.env,CLIPPOCKET_TEST_MODE:''},windowsHide:true,stdio:['ignore','ignore','pipe']});second.stderr.on('data',x=>process.stderr.write(x));await waitFor(()=>second.exitCode!==null);assert.equal(second.exitCode,0);assert.equal(JSON.parse(await fsp.readFile(path.join(FIXTURE,'.instance.json'),'utf8')).pid,child.pid);report.checks.push('repeated launch reuses the same server and owned window');
  await page.locator('#downloads').click();const manager=await waitFor(()=>context.pages().find(p=>p.url().startsWith('edge://downloads')));await manager.waitForLoadState('domcontentloaded');report.checks.push('dedicated window opens its native browser download manager');console.log('Repeated launch and native download manager passed');
  // Save a real YouTube MP3 through the owned browser, into the isolated fixture.
  const saveRoot=path.join(FIXTURE,'saved');await fsp.mkdir(saveRoot);
  const cdp=await context.newCDPSession(page);await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:saveRoot,eventsEnabled:true});
  await page.bringToFront();await page.locator('input[value="mp3"]').check();await page.locator('#url').fill('https://www.youtube.com/watch?v=jNQXAC9IVRw');
  const downloadEvent=page.waitForEvent('download',{timeout:180000});await page.locator('#download').click();const download=await downloadEvent;assert.equal(await download.failure(),null);
  await waitFor(async()=>{const s=(await api('state')).data;assert.equal(s.error,null,s.error);return s.files.some(f=>f.delivery==='browser');});
  const saved=path.join(saveRoot,download.suggestedFilename());assert((await fsp.stat(saved)).size>1000);const savedHash=crypto.createHash('sha256').update(await fsp.readFile(saved)).digest('hex');report.checks.push('real YouTube MP3 is saved through the native download manager');console.log('Real MP3 saved');
  // Force history > 1, which blocked window.close in the ordinary-tab version.
  await page.goto('http://127.0.0.1:'+instance.port+'/style.css');await page.goto('http://127.0.0.1:'+instance.port+'/#'+instance.token);await page.waitForFunction(()=>document.querySelector('#folderPath')?.textContent.length>0);assert(await page.evaluate(()=>history.length>1));
  for(const width of [1380,850,390,320]){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow at '+width);}await cdp.send('Emulation.clearDeviceMetricsOverride');
  await page.screenshot({path:path.join(SOURCE,'evidence/managed-window.png'),fullPage:true});
  await page.locator('#shutdown').click();await gone();await waitFor(()=>disconnected);assert(page.isClosed()&&manager.isClosed());assert(!personal.isClosed());assert.equal(crypto.createHash('sha256').update(await fsp.readFile(saved)).digest('hex'),savedHash);report.checks.push('one click closes app, download manager and backend despite tab history; unrelated browser and saved file remain');
  browser=null;console.log('Shutdown button closed all owned windows and server');
  const again=await boot();console.log('Reopened owned profile');const session=await browser.contexts()[0].newCDPSession(again);await session.send('Page.close');await gone();report.checks.push('native window close also shuts down the local tool; profile can reopen');browser=null;
  report.status='pass';report.testedAt=new Date().toISOString();await fsp.writeFile(path.join(SOURCE,'evidence/managed-window-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{if(instance&&child?.exitCode===null)try{await api('shutdown',{});}catch{}if(browser)await browser.close().catch(()=>{});if(unrelated)await unrelated.close();if(child?.exitCode===null){await delay(5000);if(child.exitCode===null)child.kill();}}
})().catch(e=>{console.error(String(e.stack||e).replaceAll(instance?.token||'__no_token__','<REDACTED>'));process.exitCode=1;});
