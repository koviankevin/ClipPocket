'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.CLIPPOCKET_PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'..'),VERSION=require('../version.json').version,delay=ms=>new Promise(r=>setTimeout(r,ms));
const executable=process.env.CLIPPOCKET_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let child,browser,instance;const report={version:VERSION,browser:path.basename(executable),checks:[]};
async function boot(){child=spawn(path.join(ROOT,'bin/node.exe'),[path.join(ROOT,'app.cjs'),'--no-open'],{cwd:ROOT,windowsHide:true,stdio:'ignore'});const end=Date.now()+30000;while(Date.now()<end){try{const i=JSON.parse(await fsp.readFile(path.join(ROOT,'.instance.json'),'utf8'));if(i.pid===child.pid){const r=await fetch('http://127.0.0.1:'+i.port+'/health',{signal:AbortSignal.timeout(500)});if((await r.json()).version===VERSION){instance=i;return;}}}catch{}await delay(100);}throw Error('Startup timeout');}
function url(){return'http://127.0.0.1:'+instance.port+'/#'+instance.token;}
async function gone(){await delay(1700);assert.notEqual(child.exitCode,null,'Local process must exit');let closed=false;try{await fetch('http://127.0.0.1:'+instance.port+'/health',{signal:AbortSignal.timeout(500)});}catch{closed=true;}assert(closed,'Local listener must stop');}
(async()=>{
 try{
  browser=await chromium.launch({executablePath:executable,headless:true});const context=await browser.newContext(),controller=await context.newPage();
  await controller.setContent('<button id="open">Open tool</button><p id="unrelated">Keep this tab</p>');
  await boot();await controller.evaluate(target=>document.querySelector('#open').onclick=()=>window.open(target,'_blank'),url());
  let event=context.waitForEvent('page');await controller.locator('#open').click();const popup=await event;await popup.waitForFunction(()=>document.querySelector('#folderPath')?.textContent.length>0);
  let didClose=false;popup.on('close',()=>didClose=true);await popup.locator('#shutdown').click();await delay(2300);
  console.log(JSON.stringify({scriptOpenedTabClosed:didClose,unrelatedTabOpen:!controller.isClosed()}));assert(didClose,'Shutdown must automatically close a script-opened tool tab');assert(!controller.isClosed());await gone();report.checks.push('script-opened tool tab closes; local program exits; unrelated tab stays open');
  await boot();const manual=await context.newPage();
  // A normal tab with a previous document is deliberately not script-closable.
  await manual.goto('http://127.0.0.1:'+instance.port+'/style.css');await manual.goto(url());await manual.waitForFunction(()=>document.querySelector('#folderPath').textContent.length>0);assert(await manual.evaluate(()=>history.length>1));
  await manual.locator('#shutdown').click();await delay(2300);assert(!manual.isClosed());assert(await manual.locator('#closedPanel').isVisible());assert(await manual.locator('main').isHidden());assert.match(await manual.locator('#closedHint').textContent(),/瀏覽器|Ctrl/);await gone();report.checks.push('browser-blocked close retains a clear fallback and still stops the tool');await manual.close();
  await boot();await controller.evaluate(target=>document.querySelector('#open').onclick=()=>window.open(target,'_blank'),url());event=context.waitForEvent('page');await controller.locator('#open').click();const blocked=await event;await blocked.waitForFunction(()=>document.querySelector('#folderPath')?.textContent.length>0);
  await blocked.route('**/api/shutdown',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'瀏覽器仍在接收檔案，請等傳送完成。'})}));await blocked.locator('#shutdown').click();await delay(500);assert(!blocked.isClosed());assert(await blocked.locator('main').isVisible());assert.equal(child.exitCode,null);report.checks.push('rejected shutdown keeps the tab and local process alive');
  await blocked.unroute('**/api/shutdown');await blocked.locator('#shutdown').click();await delay(2300);assert(blocked.isClosed());await gone();assert(!controller.isClosed());
  report.status='pass';report.testedAt=new Date().toISOString();const name=path.basename(executable).toLowerCase()==='chrome.exe'?'tab-close-chrome-report.json':'tab-close-report.json';await fsp.writeFile(path.join(ROOT,'evidence',name),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{if(instance&&child?.exitCode===null)try{await fetch('http://127.0.0.1:'+instance.port+'/api/shutdown',{method:'POST',headers:{'X-ClipPocket-Token':instance.token,'Content-Type':'application/json'},body:'{}'});}catch{}if(browser)await browser.close();if(child?.exitCode===null){await delay(1800);if(child.exitCode===null)child.kill();}}
})().catch(e=>{console.error(String(e.stack||e).replaceAll(instance?.token||'__no_token__','<REDACTED>'));process.exitCode=1;});
