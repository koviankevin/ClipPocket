'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {releaseInfo,formatSize}=require('../../docs/release.js');
const REPO='https://github.com/koviankevin/ClipPocket';
function asset(name,version='v0.4.0',size=142500000){return {name,state:'uploaded',size,browser_download_url:REPO+'/releases/download/'+version+'/'+name};}
function release(assets,extra={}){return {tag_name:'v0.4.0',draft:false,prerelease:false,assets,...extra};}

test('A future release selects its Windows ZIP and checksum instead of source archives or older versions',()=>{
  const name='ClipPocket-0.4.0-Windows-x64-portable.zip';
  const info=releaseInfo(release([asset('ffmpeg-source.zip'),asset('ClipPocket-0.3.0-Windows-x64-portable.zip'),asset(name),asset(name+'.sha256','v0.4.0',109)]));
  assert.equal(info.version,'v0.4.0');assert.equal(info.name,name);assert.equal(info.bytes,142500000);
  assert.equal(info.downloadUrl,REPO+'/releases/download/v0.4.0/'+name);
  assert.equal(info.checksumUrl,info.downloadUrl+'.sha256');
  assert.equal(formatSize(131147634),'131 MB');assert.equal(formatSize(2200000000),'2.2 GB');
});

test('Stable filename works; a release missing its Windows package does not select an older ZIP',()=>{
  const info=releaseInfo(release([asset('ClipPocket-Windows-x64-portable.zip')]));
  assert(info.downloadUrl.endsWith('/ClipPocket-Windows-x64-portable.zip'));assert.equal(info.checksumUrl,null);
  const missing=releaseInfo(release([asset('ClipPocket-0.3.0-Windows-x64-portable.zip')]));
  assert.equal(missing.downloadUrl,null);assert.equal(missing.releaseUrl,REPO+'/releases/tag/v0.4.0');
});

test('Drafts, prereleases, unfinished uploads and foreign or mismatched URLs are excluded',()=>{
  assert.throws(()=>releaseInfo(release([],{draft:true})));
  assert.throws(()=>releaseInfo(release([],{prerelease:true})));
  assert.throws(()=>releaseInfo({message:'API limit'}));
  const name='ClipPocket-0.4.0-Windows-x64-portable.zip';
  for(const change of [{state:'starter'},{size:0},{size:NaN},{browser_download_url:'https://unrelated.example/'+name},{browser_download_url:REPO+'/releases/download/v0.3.0/'+name}]){
    assert.equal(releaseInfo(release([{...asset(name),...change}])).downloadUrl,null);
  }
});
