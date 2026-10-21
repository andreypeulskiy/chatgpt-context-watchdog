'use strict';
// Only use prebuilt artifacts in functional/visual QA if BOTH the source tree
// and both bundles match a recorded baseline. Changes to product sources fail
// closed until a proper rebuild; stale bundles cannot silently pass QA.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=require('../tests/support/bundle-provenance.json');
function sha(data) {return crypto.createHash('sha256').update(data).digest('hex');}
function sourceFingerprint() {
 const src=path.join(root,'src');
 const entries=[];
 function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  const name=path.join(p,e.name); if(e.isDirectory())walk(name);else if(e.isFile())entries.push(name);
 }}
 walk(src);
 const hash=crypto.createHash('sha256');
 for(const file of entries){hash.update(path.relative(src,file).split(path.sep).join('/'));hash.update('\0');hash.update(fs.readFileSync(file));hash.update('\0');}
 return hash.digest('hex');
}
function verify() {
 if(sourceFingerprint()!==manifest.sourceSha256)throw Error('Product source differs from recorded prebuilt baseline; rebuild with canonical esbuild');
 for(const [variant,entry] of Object.entries(manifest.artifacts)) {
  const file=path.join(root,entry.relative);
  if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==entry.sha256)throw Error(`${variant} prebuilt SHA mismatch`);
 }
 return manifest.artifacts;
}
if(require.main===module) {
 try {verify();console.log('PASS verified prebuilt sources + Stable/Dev SHA-256');}
 catch(error) {console.error('FAIL',error.message);process.exitCode=1;}
}
module.exports={verify,sourceFingerprint};
