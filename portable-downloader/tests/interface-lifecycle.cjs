'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.CLIPPOCKET_PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(process.env.CLIPPOCKET_APP_ROOT||path.join(__dirname,'..')),VERSION=JSON.parse(fs.readFileSync(path.join(ROOT,'version.json'),'utf8')).version;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child,browser,instance;const results={version:VERSION,checks:[]};
async function launch(){child=spawn(path.join(ROOT,'bin/node.exe'),[path.join(ROOT,'app.cjs'),'--no-open'],{cwd:ROOT,windowsHide:true,stdio:'ignore'});child.on('error',e=>{throw e;});const end=Date.now()+30000;while(Date.now()<end){try{const i=JSON.parse(await fsp.readFile(path.join(ROOT,'.instance.json'),'utf8'));if(i.pid===child.pid){const r=await fetch('http://127.0.0.1:'+i.port+'/health',{signal:AbortSignal.timeout(1000)});if((await r.json()).version===VERSION){instance=i;return;}}}catch{}await delay(100);}throw Error('Startup timeout');}
async function api(route,body){const r=await fetch('http://127.0.0.1:'+instance.port+'/api/'+route,{method:body?'POST':'GET',headers:{'X-ClipPocket-Token':instance.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};}
(async()=>{
 try{
  await launch();browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const context=await browser.newContext({viewport:{width:1380,height:950}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Keep a previous document so browser policy deliberately blocks auto-close;
  // tab-close.cjs separately covers successful automatic closing.
  await page.goto('http://127.0.0.1:'+instance.port+'/style.css');await page.goto('http://127.0.0.1:'+instance.port+'/#'+instance.token);await page.waitForFunction(()=>document.querySelector('#folderPath').textContent.length>0);
  const other=await page.context().newPage();await other.goto('http://127.0.0.1:'+instance.port+'/#'+instance.token);await other.waitForFunction(()=>document.querySelector('#folderPath').textContent.length>0);
  // Record both signals independently: a dead process alone is easy to miss
  // when the remaining browser tab still looks like the working interface.
  await page.locator('#shutdown').click();await delay(1800);
  const exited=child.exitCode!==null;let endpointClosed=false;try{await fetch('http://127.0.0.1:'+instance.port+'/health',{signal:AbortSignal.timeout(1000)});}catch{endpointClosed=true;}
  const closedVisible=await page.locator('#closedPanel').isVisible().catch(()=>false),oldMainHidden=await page.locator('main').isHidden();
  console.log(JSON.stringify({shutdown:{processExited:exited,endpointClosed,closedVisible,oldMainHidden}}));
  assert(exited&&endpointClosed,'Closing must terminate the local server and process');
  assert(closedVisible&&oldMainHidden,'Closing must replace the working UI with a prominent closed screen');
  assert(await other.locator('#closedPanel').isVisible(),'Other open tabs must also leave the working UI');assert(await other.locator('main').isHidden());await other.close();
  await page.screenshot({path:path.join(__dirname,'../evidence/interface-closed.png'),fullPage:true});
  results.checks.push('shutdown terminates backend and replaces the working UI in all open tabs');
  // A page opened by the launcher can normally close itself; an ordinary user
  // tab cannot. The prominent closed screen must work in both cases.
  await launch();await page.goto('http://127.0.0.1:'+instance.port+'/#'+instance.token);await page.waitForFunction(()=>document.querySelector('#folderPath').textContent.length>0);
  const sizes=await page.evaluate(()=>Object.fromEntries(['url','download','shutdown','delivery','qualityHint'].map(id=>[id,parseFloat(getComputedStyle(document.getElementById(id)).fontSize)])));
  console.log(JSON.stringify({fontSizes:sizes}));for(const id of ['url','download','shutdown','delivery'])assert(sizes[id]>=16,id+' must have at least 16px text');assert(sizes.qualityHint>=14,'Supporting text must be at least 14px');
  results.checks.push('readable control sizes and supporting text');
  for(const width of [1380,850,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow at '+width);}
  await page.screenshot({path:path.join(__dirname,'../evidence/interface-mobile.png'),fullPage:true});results.checks.push('desktop and narrow layouts do not overflow');
  await page.route('**/api/shutdown',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'瀏覽器仍在接收檔案，請等傳送完成後再關閉工具。'})}));
  await page.locator('#shutdown').click();await page.waitForFunction(()=>!document.querySelector('#notice').hidden);assert(await page.locator('main').isVisible());assert(await page.locator('#closedPanel').isHidden());assert(await page.locator('#shutdown').isEnabled());await page.unroute('**/api/shutdown');
  results.checks.push('blocked shutdown shows an error and keeps the working interface available');
  // Reproduce the race where a state response is already in flight when the
  // user closes the app. It must not overwrite the final closed screen.
  await page.route('**/api/state',async route=>{await delay(900);try{await route.continue();}catch{}});
  await page.waitForTimeout(750);await page.locator('#shutdown').click();await delay(1600);assert(await page.locator('#closedPanel').isVisible());assert(await page.locator('main').isHidden());assert.match(await page.locator('#closedPanel').textContent(),/已關閉/);
  results.checks.push('in-flight polling cannot overwrite the closed state');assert.deepEqual(errors,[]);
  results.status='pass';results.testedAt=new Date().toISOString();await fsp.writeFile(path.join(__dirname,'../evidence/interface-report.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
 }finally{if(instance&&child?.exitCode===null)try{await api('shutdown',{});}catch{}if(browser)await browser.close();if(child?.exitCode===null){await delay(2000);if(child.exitCode===null)child.kill();}}
})().catch(e=>{console.error(e);process.exitCode=1;});
