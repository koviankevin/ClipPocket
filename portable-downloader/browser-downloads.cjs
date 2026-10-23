'use strict';
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const crypto=require('node:crypto');
const {pipeline}=require('node:stream');

// Each process owns one cache directory. A crashed process's cache is removed
// on the next launch; files being served stay available until this tool closes.
class BrowserDownloads {
  constructor(dataRoot) {
    this.root=path.join(dataRoot,'browser-downloads');
    this.session=path.join(this.root,crypto.randomUUID());
    this.files=new Map();
    this.tickets=new Map();
    this.active=0;
  }
  async prepare() {
    await fsp.mkdir(this.root,{recursive:true});
    for(const entry of await fsp.readdir(this.root,{withFileTypes:true})) {
      if(!entry.isDirectory()||!/^[a-f0-9-]{36}$/.test(entry.name))continue;
      const dir=path.join(this.root,entry.name);
      let owner;
      try { owner=JSON.parse(await fsp.readFile(path.join(dir,'owner.json'),'utf8')); }
      catch { continue; }
      if(!Number.isInteger(owner.pid)||owner.pid<1)continue;
      try { process.kill(owner.pid,0); }
      catch(error) { if(error.code==='ESRCH')await fsp.rm(dir,{recursive:true,force:true}); }
    }
    await fsp.mkdir(this.session);
    await fsp.writeFile(path.join(this.session,'owner.json'),JSON.stringify({pid:process.pid}));
  }
  target(id,extension) { return path.join(this.session,id+'.'+extension); }
  register(file) { this.files.set(file.id,file); }
  issue(id) {
    const file=this.files.get(id);
    if(!file||!fs.existsSync(file.path))throw Error('暫存檔已清除，請重新處理影片。');
    const ticket=crypto.randomBytes(32).toString('hex');
    // Bound ticket storage, while preserving links used for browser retries.
    if(this.tickets.size>=200)this.tickets.delete(this.tickets.keys().next().value);
    this.tickets.set(ticket,file);
    return {url:'/download/'+ticket,name:file.name};
  }
  async serve(req,res,ticket) {
    if(!['GET','HEAD'].includes(req.method)) { res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return; }
    if(req.headers['sec-fetch-site']==='cross-site') { res.writeHead(403);res.end();return; }
    const file=this.tickets.get(ticket);
    if(!file) { res.writeHead(404);res.end();return; }
    let stat;
    try { stat=await fsp.stat(file.path); }
    catch { res.writeHead(410);res.end();return; }
    const size=stat.size;
    let start=0,end=size-1,status=200;
    const headers={
      'Content-Type':file.format==='mp3'?'audio/mpeg':'video/mp4',
      'Content-Disposition':`attachment; filename="ClipPocket.${file.format}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`,
      'Accept-Ranges':'bytes','Cache-Control':'private, no-store',
      'ETag':'"'+file.id+'"','Last-Modified':stat.mtime.toUTCString()
    };
    if(req.headers.range&&(!req.headers['if-range']||req.headers['if-range']===headers.ETag||req.headers['if-range']===headers['Last-Modified'])) {
      const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      let valid=Boolean(range&&(range[1]||range[2]));
      if(valid) {
        if(!range[1]) { const tail=Number(range[2]);start=Math.max(0,size-tail);valid=tail>0; }
        else { start=Number(range[1]);if(range[2])end=Math.min(Number(range[2]),size-1); }
        valid=valid&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start;
      }
      if(!valid) { res.writeHead(416,{'Content-Range':'bytes */'+size,'Content-Length':'0'});res.end();return; }
      status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length']=String(size===0?0:end-start+1);
    // Opening first avoids sending a successful attachment response for a
    // vanished file. pipeline destroys the reader when a browser disconnects.
    const handle=await fsp.open(file.path,'r');
    if(req.method==='HEAD'||size===0) { await handle.close();res.writeHead(status,headers);res.end();return; }
    this.active++;
    res.writeHead(status,headers);
    pipeline(handle.createReadStream({start,end}),res,()=>{this.active--;});
  }
  async close() {
    if(this.active)throw Error('瀏覽器仍在接收檔案，請等傳送完成後再關閉工具。');
    await fsp.rm(this.session,{recursive:true,force:true});
  }
}
function deliveryRequest(input) {
  const delivery=input.delivery===undefined?'browser':input.delivery;
  if(!['browser','folder'].includes(delivery))throw Error('請選擇瀏覽器儲存或直接存到資料夾。');
  return delivery;
}
module.exports={BrowserDownloads,deliveryRequest};
