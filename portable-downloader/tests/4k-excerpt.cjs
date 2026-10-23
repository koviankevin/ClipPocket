const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const run=require('node:util').promisify(require('node:child_process').execFile);
const assert=require('node:assert/strict');
const root=path.resolve('portable-downloader'),evidence=path.join(root,'evidence');
const {selectQuality,outputRequest}=require(path.join(root,'quality.cjs'));
(async()=>{
 const info=JSON.parse(fs.readFileSync(path.join(evidence,'youtube4k-info.json'),'utf8').replace(/^\uFEFF/,''));
 const selection=selectQuality(info,outputRequest({format:'mp4',quality:'q-2160-60',mode:'original'}));
 const result=await run(path.join(root,'bin/yt-dlp.exe'),['--ignore-config','--no-plugin-dirs','--plugin-dirs',path.join(root,'compat'),'--no-playlist','--no-cache-dir','--no-js-runtimes','--js-runtimes','node:'+path.join(root,'bin/node.exe'),'--ffmpeg-location',path.join(root,'bin/ffmpeg'),'--socket-timeout','25','--retries','1','-f',selection.selector,'--download-sections','*0-3','--merge-output-format','mp4','--remux-video','mp4','-o',path.join(evidence,'youtube-4k-excerpt.%(ext)s'),'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],{windowsHide:true,timeout:240000,maxBuffer:4*1024*1024});
 fs.writeFileSync(path.join(evidence,'4k-excerpt.log'),result.stdout+'\n'+result.stderr);
 const file=path.join(evidence,'youtube-4k-excerpt.mp4');
 const probe=JSON.parse((await run(path.join(root,'bin/ffmpeg/ffprobe.exe'),['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate','-of','json',file],{windowsHide:true})).stdout);
 assert(probe.streams.some(s=>s.width===3840&&s.height===2160&&s.avg_frame_rate==='60/1'));
 assert(Number(probe.format.duration)<10);
 await run(path.join(root,'bin/ffmpeg/ffmpeg.exe'),['-nostdin','-v','error','-i',file,'-f','null','-'],{windowsHide:true,timeout:120000,maxBuffer:1024*1024});
 const report={status:'pass',testedAt:new Date().toISOString(),scope:'Actual source download and full decode of the opening 3-second excerpt; not a full-video 4K download',quality:selection.option,probe,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
 fs.writeFileSync(path.join(evidence,'4k-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(String(error.message).replace(/https?:\/\/\S+/g,url=>url.split('?')[0]));process.exitCode=1;});
