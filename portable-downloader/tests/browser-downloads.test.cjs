'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const http=require('node:http'),crypto=require('node:crypto');
const {BrowserDownloads,deliveryRequest}=require('../browser-downloads.cjs');

test('Browser handoff streams attachment bytes, ranges, retries and Unicode filenames; cleans only owned cache',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clippocket-browser-test-'));
  const downloads=new BrowserDownloads(root);let server;
  try {
    assert.equal(deliveryRequest({}),'browser');assert.equal(deliveryRequest({delivery:'folder'}),'folder');
    assert.throws(()=>deliveryRequest({delivery:'arbitrary'}));
    await downloads.prepare();
    const bytes=crypto.randomBytes(1024*256),id=crypto.randomUUID();
    const file={id,path:downloads.target(id,'mp4'),name:"繁體中文 '影片' [測試].mp4",format:'mp4'};
    await fs.writeFile(file.path,bytes);downloads.register(file);
    server=http.createServer((req,res)=>downloads.serve(req,res,req.url.slice(10)).catch(error=>res.destroy(error)));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const link=downloads.issue(id).url;
    let response=await fetch(base+link);assert.equal(response.status,200);
    assert(response.headers.get('content-disposition').includes("filename*=UTF-8''%E7%B9%81"));
    assert(response.headers.get('content-disposition').includes('%27'));
    assert.equal(response.headers.get('content-length'),String(bytes.length));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    response=await fetch(base+link,{headers:{Range:'bytes=10-99'}});assert.equal(response.status,206);
    assert.equal(response.headers.get('content-range'),'bytes 10-99/'+bytes.length);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(10,100));
    response=await fetch(base+link,{headers:{Range:'bytes=-32'}});
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(-32));
    for(const range of ['bytes=999999-','bytes=100-99','bytes=0-10,20-30','bytes=-0'])assert.equal((await fetch(base+link,{headers:{Range:range}})).status,416);
    response=await fetch(base+link,{method:'HEAD'});assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,0);
    response=await fetch(base+link,{headers:{Range:'bytes=10-99','If-Range':'"wrong-file"'}});
    assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    assert.equal((await fetch(base+'/download/unknown')).status,404);
    assert.equal((await fetch(base+link,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.throws(()=>downloads.issue('arbitrary-path'));
    // A live second process/session must not be cleaned by another startup.
    const second=new BrowserDownloads(root);await second.prepare();await fs.access(file.path);await second.close();
    const largeId=crypto.randomUUID(),large={id:largeId,path:downloads.target(largeId,'mp4'),name:'large.mp4',format:'mp4'};
    await fs.writeFile(large.path,Buffer.alloc(16*1024*1024));downloads.register(large);
    await new Promise((resolve,reject)=>{
      const req=http.get(base+downloads.issue(largeId).url,res=>{
        res.pause();assert.equal(downloads.active,1);
        downloads.close().then(()=>reject(Error('Closed during browser transfer')),()=>{res.destroy();resolve();});
      });req.on('error',reject);
    });
    for(let n=0;downloads.active&&n<50;n++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(downloads.active,0);
    // Interruption does not delete the ready file, so a browser can retry.
    response=await fetch(base+link);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    for(let n=0;downloads.active&&n<50;n++)await new Promise(resolve=>setTimeout(resolve,20));
    await downloads.close();await assert.rejects(fs.access(file.path));
  }finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    await fs.rm(root,{recursive:true,force:true});
  }
});
