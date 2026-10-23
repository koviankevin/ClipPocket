'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {releaseInfo,newer,downloadVerified,Updates}=require('../updates.cjs');
function release(version='0.10.0'){const name='ClipPocket-'+version+'-Windows-x64-portable.zip';return{tag_name:'v'+version,draft:false,prerelease:false,published_at:'2026-10-23T00:00:00Z',assets:[{name,state:'uploaded',size:5,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/koviankevin/ClipPocket/releases/download/v'+version+'/'+name}]};}
test('numeric stable versions; reject downgrades, draft releases and untrusted artifacts',()=>{
  assert(newer('0.10.0','0.9.9'));assert(!newer('0.4.0','0.4.0'));assert(!newer('0.3.0','0.4.0'));
  assert.equal(releaseInfo(release(),'0.9.0').version,'0.10.0');assert.equal(releaseInfo(release(),'1.0.0'),null);
  for(const mutate of [x=>x.draft=true,x=>x.prerelease=true,x=>x.tag_name='v0.4.0-rc.1',x=>x.assets[0].digest=null,x=>x.assets[0].browser_download_url='https://evil.invalid/payload.zip',x=>x.assets[0].size=1e12]){const r=release();mutate(r);assert.throws(()=>releaseInfo(r,'0.3.0'));}
});
test('streamed package digest and size checks remove incomplete or tampered files',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'clippocket-download-test-')),file=path.join(temp,'payload.zip'),data=Buffer.from('complete package');
  const info={url:'https://example.invalid/fixture',bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};
  try{await downloadVerified(info,file,()=>{},async()=>new Response(data));assert.deepEqual(await fs.readFile(file),data);await fs.unlink(file);
    for(const body of [Buffer.from('truncated'),Buffer.from('wrong package!!!'),Buffer.concat([data,Buffer.from('extra')])]){await assert.rejects(downloadVerified(info,file,()=>{},async()=>new Response(body)));await assert.rejects(fs.access(file));}
    await assert.rejects(downloadVerified(info,file,()=>{},async()=>new Response(null,{status:503})));await assert.rejects(fs.access(file));
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('offline checks remain nonfatal; busy work prevents all installation activity',async()=>{
  const offline=new Updates('.', '0.4.0',{fetcher:async()=>{throw Error('offline');}});await offline.check();assert.equal(offline.state.phase,'error');assert.equal(offline.busy,false);
  let requests=0;const updater=new Updates('.','0.3.0',{fetcher:async()=>{requests++;return new Response(JSON.stringify(release()));}});await updater.check();assert.equal(updater.state.phase,'available');
  await assert.rejects(updater.install(()=>{throw Error('download active');},()=>{}),/download active/);assert.equal(requests,1);assert.equal(updater.busy,false);
  updater.state.phase='checking';await assert.rejects(updater.install(()=>{},()=>{}),/等待更新檢查/);assert.equal(updater.busy,false);
});
