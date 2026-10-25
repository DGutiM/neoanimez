// Local browser QA with isolated auth. Never reads or writes a real user account.
const { chromium, webkit, devices } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PREVIEW_PORT || 4197);
const server = spawn(process.execPath, [path.join(__dirname,'serve-preview.cjs'),`--port=${port}`,'--mock-auth'], {cwd:root,stdio:['ignore','pipe','pipe']});
const ready = new Promise((resolve,reject)=>{
  server.stdout.once('data',resolve);
  server.once('error',reject);
  server.once('exit',code=>reject(new Error(`preview exited ${code}`)));
});
(async()=>{
  try {
    await ready;
    for(const [name,engine,options] of [
      ['desktop',chromium,{viewport:{width:1440,height:1000}}],
      ['android',chromium,{...devices['Pixel 7']}],
      ['iphone-layout',fs.existsSync(webkit.executablePath())?webkit:chromium,{...devices['iPhone 13']}],
    ]) {
      const browser=await engine.launch({headless:true,...(engine===chromium?{channel:'chrome'}:{})});
      try {
        const page=await browser.newPage(options);
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>typeof DB!=='undefined'&&DB.length>7700);
        const reject=page.getByRole('button',{name:'Rechazar',exact:true});
        if(await reject.isVisible())await reject.click();
        await page.evaluate(()=>openAnimeModal(DB.find(item=>item.mal_id===52991)));
        await page.waitForFunction(()=>document.querySelector('#animeModalImg')?.naturalWidth>1,null,{timeout:20000});
        assert.equal(await page.locator('#animeModal').evaluate(e=>e.classList.contains('open')),true);
        await page.screenshot({path:`/tmp/neoanimez-transition-${name}.png`});
        await page.evaluate(()=>closeAnimeModal());
        assert.equal(await page.locator('#animeModal').evaluate(e=>e.classList.contains('open')),false);
        const widths=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);
        assert.ok(widths[0]<=widths[1]+1,`${name}: horizontal overflow`);
        assert.deepEqual(errors,[],`${name}: JS errors`);
        console.log(`PASS ${name}: catalogue, cover, modal open/close, layout`);
      } finally {await browser.close();}
    }
  } finally {server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
