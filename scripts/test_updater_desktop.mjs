import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const root = process.cwd();
const manifest = {version:'999.0.0',notes:'Signature smoke test',platforms:{'windows-x86_64':{url:'http://127.0.0.1:19899/fixture.exe',signature:fs.readFileSync('.test-data/updater-fixture.bin.sig','utf8').trim()}}};
const server = http.createServer((req,res) => {
 if(req.url === '/latest.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(manifest));}
 else {res.end('tampered-update-data');}
});
await new Promise(resolve=>server.listen(19899,'127.0.0.1',resolve));
const child = spawn(path.join(root,'src-tauri/target/release/nai-aclab.exe'),[],{windowsHide:true,env:{...process.env,NAI_ARTIST_LAB_USER_DIR:path.join(root,'.test-data','updater-'+Date.now()),NAI_ACLAB_HEADLESS_TEST:'1',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19225'}});
let browser;
try {
 for(let i=0;i<60;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19225');break}catch{await new Promise(r=>setTimeout(r,500))}}
 if(!browser)throw new Error('WebView2 did not start');
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:'));
 await page.getByRole('button',{name:'새 버전 999.0.0'}).waitFor();
 const result = await page.evaluate(async()=>{
  const ipc=window.__TAURI_INTERNALS__;
  const found=await ipc.invoke('check_update');
  if(found.version!=='999.0.0')throw new Error('Update not detected');
  const failures=[];
  for(let i=0;i<2;i++){
   const id=ipc.transformCallback(()=>{});
   try{await ipc.invoke('install_update',{version:'999.0.0',progress:`__CHANNEL__:${id}`});throw new Error('Tampered update accepted');}
   catch(error){failures.push(String(error));}
  }
  const state=await fetch('/api/state',{headers:{'X-NAI-ACLAB-Token':window.__NAI_ACLAB_TOKEN__}});
  return {failures,engineAlive:state.ok};
 });
 if(!result.engineAlive || result.failures.some(e=>!/signature|verify|verification/i.test(e)))throw new Error(JSON.stringify(result));
 console.log(JSON.stringify({update_detection:'passed',tampered_download_rejected:'passed',retry:'passed',engine_preserved:'passed'}));
} finally {
 if(browser)await browser.close();
 try{execFileSync('python',['scripts/close_test_window.py',String(child.pid)],{windowsHide:true});}catch{}
 await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill();resolve()},5000)});
 server.close();
}
