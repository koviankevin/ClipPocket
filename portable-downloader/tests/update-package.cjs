'use strict';
// Uses the real portable ZIP and browser UI, with a private older-version fixture.
// Test-only fetch substitution is injected into that fixture, never shipped.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process'),execute=require('node:util').promisify(execFile);
const {chromium}=require(process.env.CLIPPOCKET_PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'..'),VERSION=require('../version.json').version,BASE=path.resolve(ROOT,'../portable-build-cache/full-update-'+crypto.randomUUID()),ARCHIVE=path.resolve(ROOT,'../releases/ClipPocket-'+VERSION+'-Windows-x64-portable.zip');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser,instance,installed;
async function api(route,body,headers={}){const r=await fetch('http://127.0.0.1:'+instance.port+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'X-ClipPocket-Token':instance.token,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});return{status:r.status,data:await r.json()};}
async function boot(version){const end=Date.now()+60000;while(Date.now()<end){try{const i=JSON.parse(await fsp.readFile(path.join(installed,'.instance.json'),'utf8'));const r=await fetch('http://127.0.0.1:'+i.port+'/health',{signal:AbortSignal.timeout(1000)});if((await r.json()).version===version){instance=i;return;}}catch{}await delay(200);}throw Error('Boot timeout '+version);}
(async()=>{
  try{
    await fsp.mkdir(BASE,{recursive:true});
    await execute(process.env.CLIPPOCKET_PWSH||'pwsh',['-NoProfile','-Command','Expand-Archive -LiteralPath $env:CLIPPOCKET_TEST_ZIP -DestinationPath $env:CLIPPOCKET_TEST_DEST'],{env:{...process.env,CLIPPOCKET_TEST_ZIP:ARCHIVE,CLIPPOCKET_TEST_DEST:BASE},windowsHide:true,timeout:120000});
    installed=path.join(BASE,'ClipPocket');assert(!fs.existsSync(path.join(installed,'data')),'Package must not contain user data');const data=await fsp.readFile(ARCHIVE),sha256=crypto.createHash('sha256').update(data).digest('hex'),filename=path.basename(ARCHIVE);
    const release={tag_name:'v'+VERSION,draft:false,prerelease:false,published_at:new Date().toISOString(),assets:[{name:filename,state:'uploaded',size:data.length,digest:'sha256:'+sha256,browser_download_url:'https://github.com/koviankevin/ClipPocket/releases/download/v'+VERSION+'/'+filename}]};
    const loader=path.join(BASE,'fixture-preload.cjs');
    await fsp.writeFile(loader,"const realFetch=global.fetch;global.fetch=async(url,options)=>String(url).startsWith('https://api.github.com/')?new Response("+JSON.stringify(JSON.stringify(release))+"):String(url)==="+JSON.stringify(release.assets[0].browser_download_url)+"?new Response(require('node:stream').Readable.toWeb(require('node:fs').createReadStream("+JSON.stringify(ARCHIVE)+"))):realFetch(url,options);\n");
    const older='0.3.9';await fsp.writeFile(path.join(installed,'version.json'),JSON.stringify({version:older,name:'ClipPocket',platform:'windows-x64'}));
    const folder=path.join(installed,'Downloads'),settings=JSON.stringify({folder}),history='[]';await fsp.mkdir(path.join(installed,'data'),{recursive:true});await fsp.mkdir(folder);
    await fsp.writeFile(path.join(installed,'data/settings.json'),settings);await fsp.writeFile(path.join(installed,'data/history.json'),history);await fsp.writeFile(path.join(folder,'keep.mp4'),'previously saved video');await fsp.writeFile(path.join(installed,'personal-notes.txt'),'keep user file');
    const child=spawn(path.join(installed,'bin/node.exe'),['--require',loader,path.join(installed,'app.cjs')],{cwd:installed,env:{...process.env,CLIPPOCKET_TEST_MODE:'1'},windowsHide:true,stdio:'ignore'});child.on('error',e=>{throw e;});await boot(older);
    assert.equal((await api('update-check',{}, {'X-ClipPocket-Token':'invalid'})).status,403);assert.equal((await api('update-install',{}, {Origin:'https://example.invalid'})).status,403);
    await api('update-check',{});const limit=Date.now()+20000;while((await api('state')).data.update.phase==='checking'){if(Date.now()>limit)throw Error('Update check timeout');await delay(200);}
    assert.equal((await api('state')).data.update.latest,VERSION);
    // Exercise the real API guard while a real extractor is active, then cancel.
    await api('analyze',{url:'https://www.youtube.com/watch?v=jNQXAC9IVRw'});assert.equal((await api('update-install',{})).status,400);await api('cancel',{});
    while((await api('state')).data.busy)await delay(200);
    browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const context=await browser.newContext({viewport:{width:1380,height:1100}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+instance.port+'/#'+instance.token);await page.waitForFunction(()=>!document.querySelector('#installUpdate').hidden);
    assert.match(await page.locator('#updateMessage').textContent(),new RegExp(VERSION.replaceAll('.','\\.')));assert(await page.locator('#updateWarning').isVisible());
    await page.screenshot({path:path.join(ROOT,'evidence/update-desktop.png'),fullPage:true});await page.setViewportSize({width:320,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(ROOT,'evidence/update-mobile.png'),fullPage:true});
    await page.locator('#installUpdate').click();
    try{await page.waitForFunction(()=>document.querySelector('#updateMessage').textContent.includes('正在套用更新'),{},{timeout:360000});}catch(error){console.error('Update state at timeout:',(await api('state')).data.update);throw error;}
    await boot(VERSION);let result;const deadline=Date.now()+60000;while(Date.now()<deadline){try{result=JSON.parse((await fsp.readFile(path.join(installed,'data/update-result.json'),'utf8')).replace(/^\uFEFF/,''));if(result.status==='updated')break;}catch{}await delay(200);}assert.equal(result?.status,'updated');
    assert.equal(await fsp.readFile(path.join(installed,'data/settings.json'),'utf8'),settings);assert.equal(await fsp.readFile(path.join(installed,'data/history.json'),'utf8'),history);assert.equal(await fsp.readFile(path.join(folder,'keep.mp4'),'utf8'),'previously saved video');assert.equal(await fsp.readFile(path.join(installed,'personal-notes.txt'),'utf8'),'keep user file');
    await page.goto('http://127.0.0.1:'+instance.port+'/#'+instance.token);await page.waitForFunction(v=>document.querySelector('#appVersion').textContent.includes(v),VERSION);assert.match(await page.locator('#updateMessage').textContent(),/已更新至/);assert.deepEqual(errors,[]);
    const report={status:'pass',version:VERSION,testedAt:new Date().toISOString(),archiveSha256:sha256,fromVersion:older,toVersion:VERSION,checks:['real portable ZIP fully validated','one-click browser UI installs and restarts','settings, history, saved videos and personal files preserved','authentication and origin guards','active media job blocks updating','desktop and 320px mobile layout','new version reports successful update']};
    await fsp.writeFile(path.join(ROOT,'evidence/update-package-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{if(instance)try{await api('shutdown',{});}catch{}if(browser)await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
