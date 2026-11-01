import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const root=process.cwd();
const appVersion=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const exe=path.join(root,'src-tauri/target/release/nai-aclab.exe');
const child=spawn(exe,[],{windowsHide:true,env:{...process.env,NAI_ARTIST_LAB_USER_DIR:path.join(root,'.test-data','desktop-'+Date.now()),NAI_ACLAB_HEADLESS_TEST:'1',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19223'}});
let browser;
try {
 for(let i=0;i<60;i++){
  try{browser=await chromium.connectOverCDP('http://127.0.0.1:19223');break}catch{await new Promise(r=>setTimeout(r,500))}
 }
 if(!browser)throw new Error('Desktop WebView2 did not start');
 const pages=browser.contexts().flatMap(c=>c.pages());
 const page=pages.find(p=>p.url().startsWith('http://127.0.0.1:'))||pages[0];
 await page.getByRole('button',{name:'체험 이미지 생성',exact:true}).waitFor();
 await page.evaluate(async()=>{
   const headers={'Content-Type':'application/json','X-NAI-ACLAB-Token':window.__NAI_ACLAB_TOKEN__};
   const {state}=await (await fetch('/api/state',{headers})).json();
   state.generation.fixed_artists=['artist:first','artist:second','artist:third'].map(tag=>({tag,weight:1,category:'test',prompt:`1::${tag} ::`}));
   await fetch('/api/state',{method:'POST',headers,body:JSON.stringify({state})});
 });
 await page.reload();
 await page.locator('.drag-handle').first().waitFor();
 await page.locator('.drag-handle').first().dragTo(page.locator('.fixed-artist').nth(2),{timeout:8000});
 const order=await page.locator('.fixed-artist-heading span').allTextContents();
 if(order.join(',')!=='artist:second,artist:third,artist:first')throw new Error('Native drag failed: '+order.join(','));
 await expect(page.locator('.save-status')).toHaveText('자동 저장됨');
 await page.reload();
 await page.locator('.drag-handle').first().waitFor();
 if((await page.locator('.fixed-artist-heading span').allTextContents()).join(',')!==order.join(','))throw new Error('Reorder did not persist');
 await page.getByLabel('생성 매수',{exact:true}).fill('1');
 await page.getByRole('button',{name:'체험 이미지 생성',exact:true}).click();
 await page.getByRole('button',{name:'이 시드 사용',exact:true}).click();
 const fixedSeedText=await page.locator('.seed-setting').innerText();
 await expect(page.locator('.save-status')).toHaveText('자동 저장됨');
 await page.reload();
 await expect(page.locator('.seed-setting')).toHaveText(fixedSeedText);
 await expect(page.locator('.left-panel').getByLabel('시드 모드')).toHaveCount(0);
 await expect(page.locator('.left-panel .section-heading').getByRole('button',{name:'랜덤으로 전환',exact:true})).toBeVisible();
 await expect(page.locator('select option').first()).toHaveCSS('background-color','rgb(48, 50, 52)');
 fs.mkdirSync('test-results',{recursive:true});
 await page.screenshot({path:'test-results/desktop-studio-controls.png'});
 const updateCheck = await page.evaluate(async () => {
   try { return await window.__TAURI_INTERNALS__.invoke('check_update'); }
   catch (error) { return { error: String(error) }; }
 });
 if(updateCheck.error && /not allowed|denied|허용되지|not found/i.test(updateCheck.error))throw new Error('Updater IPC failed: '+updateCheck.error);
 await page.getByRole('button',{name:'v'+appVersion,exact:true}).click();
 await page.getByRole('dialog',{name:'앱 업데이트'}).waitFor();
 await page.screenshot({path:'test-results/desktop-update-dialog.png'});
 await page.getByRole('button',{name:'업데이트 창 닫기'}).click();
 await page.getByRole('button',{name:'프롬프트',exact:true}).click();
 await page.getByRole('textbox',{name:'공통 퀄리티',exact:true}).waitFor();
 fs.mkdirSync('test-results',{recursive:true});
 await page.screenshot({path:'test-results/desktop-webview2.png'});
 const second=spawn(exe,[],{windowsHide:true});
 const secondExit=await Promise.race([new Promise(r=>second.once('exit',r)),new Promise(r=>setTimeout(()=>r('timeout'),10000))]);
 if(secondExit==='timeout'){second.kill();throw new Error('Second instance did not exit')}
 await browser.close();browser=null;
 execFileSync('python',['scripts/close_test_window.py',String(child.pid)],{windowsHide:true});
 const exit=await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(()=>r('timeout'),10000))]);
 if(exit==='timeout')throw new Error('Desktop did not exit normally');
 console.log(JSON.stringify({webview2:'passed',native_drag_and_save:'passed',updater_ipc:'passed',preset_screen:'passed',single_instance:'passed',window_close:'passed'}));
}finally{if(browser)await browser.close();if(child.exitCode===null){try{execFileSync('python',['scripts/close_test_window.py',String(child.pid)],{windowsHide:true});}catch{}setTimeout(()=>{if(child.exitCode===null)child.kill()},5000);}}
