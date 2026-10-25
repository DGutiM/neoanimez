// Exercises real UI against static data and a fake account. No Supabase writes.
const {chromium,devices}=require('playwright');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const port=Number(process.env.PREVIEW_PORT || 4198);
const base=`http://127.0.0.1:${port}/`;
const server=spawn(process.execPath,[path.join(__dirname,'serve-preview.cjs'),`--port=${port}`,'--mock-auth'],{cwd:root,stdio:['ignore','pipe','pipe']});
const ready=new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error(`server ${code}`)));});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function enter(page,query='') {
  await page.goto(base+query,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof DB!=='undefined' && DB.length>8000);
  await page.evaluate(()=>document.fonts.ready);
  const reject=page.getByRole('button',{name:'Rechazar',exact:true});if(await reject.isVisible())await reject.click();
}
async function expand(page,kind) {
  const section=page.locator(`[data-extra="${kind}"]`);
  await section.waitFor();await section.locator('summary').click();
  await page.waitForFunction(kind=>document.querySelector(`[data-extra="${kind}"] .extra-source`),kind);
}
(async()=>{
  await ready;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    for(const [name,options] of [['desktop',{viewport:{width:1440,height:1000}}],['android',{...devices['Pixel 7']}],['iphone-layout',{...devices['iPhone 13']}],['small-mobile',{viewport:{width:320,height:740},isMobile:true,hasTouch:true,deviceScaleFactor:1}]]) {
      if(process.env.SMOKE_DEVICE && process.env.SMOKE_DEVICE!==name)continue;
      const context=await browser.newContext(options);
      const page=await context.newPage();const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await enter(page,'?scenario=daily');
      await page.waitForFunction(()=>currentUser && userAnimeMap.size===6);
      await page.evaluate(()=>{showScreen('user');document.getElementById('userDailyPanel').open=true;});
      await page.waitForFunction(()=>document.querySelectorAll('.daily-continue-card').length===5);
      const ids=()=>page.locator('.daily-continue-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.animeId));
      const initial=await ids();const last=initial.at(-1);
      const plus=page.locator(`.daily-continue-card[data-anime-id="${last}"] .user-episode-plus-btn`);
      await plus.evaluate(button=>window.scrollTo({top:button.getBoundingClientRect().top+scrollY-innerHeight/2,behavior:'instant'}));await pause(400);
      const before=await plus.boundingBox();
      await plus.evaluate(button=>{window.originalStepButton=button;});
      for(let i=3;i<=5;i++) {
        // Real repeated taps at the same point, without Playwright auto-scrolling each locator click.
        if(options.hasTouch)await page.touchscreen.tap(before.x+before.width/2,before.y+before.height/2);
        else await page.mouse.click(before.x+before.width/2,before.y+before.height/2);
        await page.waitForFunction(({id,episode})=>userProgressMap.get(Number(id))?.episode_number===episode,{id:last,episode:i});
        await page.waitForFunction(id=>!document.querySelector(`.daily-continue-card[data-anime-id="${id}"] .user-episode-plus-btn`).disabled,last);
        assert.deepEqual(await ids(),initial,`${name}: plus reordered the cards`);
      }
      await page.screenshot({path:`/tmp/neoanimez-step-${name}.png`});
      assert.equal(await plus.evaluate(button=>window.originalStepButton===button),true,'step button was unnecessarily replaced');
      const after=await plus.boundingBox();assert.ok(Math.abs(after.y-before.y)<3,`${name}: plus moved ${after.y-before.y}px`);
      const minus=page.locator(`.daily-continue-card[data-anime-id="${last}"] .user-episode-minus-btn`);
      await minus.click();await page.waitForFunction(id=>userProgressMap.get(Number(id))?.episode_number===4,last);
      assert.deepEqual(await ids(),initial);
      await page.evaluate(()=>showScreen('search'));await pause(250);await page.evaluate(()=>showScreen('user'));
      await page.waitForFunction(id=>document.querySelector('.daily-continue-card')?.dataset.animeId===id,last);
      await page.screenshot({path:`/tmp/neoanimez-daily-${name}.png`});

      await page.evaluate(()=>openAnimeModal(getAnimeById(20)));
      await expand(page,'episodes');
      assert.equal(await page.locator('.extra-episode-grid li').count(),50);
      await page.locator('[data-episode-filter]').selectOption('filler');
      assert.ok(await page.locator('.extra-episode-grid li').count()>0);
      await page.locator('[data-episode-page]').selectOption({index:1});
      assert.ok(Number(await page.locator('.extra-episode-grid li strong').first().textContent())>100);
      await page.locator('.extra-guide-controls').evaluate(el=>el.scrollIntoView({block:'center'}));
      assert.ok(await page.locator('#animeModal .modal-sheet').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      await page.screenshot({path:`/tmp/neoanimez-episodes-${name}.png`});
      await page.locator('[data-extra="episodes"] summary').click();
      await expand(page,'themes');assert.ok(await page.locator('.extra-song-columns li').count()>10);
      await page.locator('.extra-song-columns h3').first().evaluate(el=>el.scrollIntoView({block:'center'}));
      await page.screenshot({path:`/tmp/neoanimez-themes-${name}.png`});
      await page.locator('[data-extra="themes"] summary').click();
      await expand(page,'recommendations');assert.ok(await page.locator('.extra-related-card').count()>0);
      await page.locator('.extra-related-card').first().evaluate(el=>el.scrollIntoView({block:'center'}));
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('.extra-related-card img')).some(i=>i.naturalWidth>1));
      await page.screenshot({path:`/tmp/neoanimez-recommendations-${name}.png`});
      const old=await page.locator('#animeModalTitle').textContent();
      await page.locator('.extra-related-card').first().click();
      assert.notEqual(await page.locator('#animeModalTitle').textContent(),old);
      await page.evaluate(()=>closeAnimeModal());

      // An expanded guide outside the original ten pilots uses the same lazy UI.
      await page.evaluate(()=>openAnimeModal(getAnimeById(16498)));
      await expand(page,'episodes');
      assert.ok(await page.locator('.extra-episode-grid li').count()>0);
      assert.ok(await page.locator('#animeModal .modal-sheet').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      await page.screenshot({path:`/tmp/neoanimez-expanded-guide-${name}.png`});
      await page.locator('#animeModal .modal-close').click();

      // A fresh, signed-out tab can open the exact shared map without a user account.
      await enter(page,'?saga=52991');
      await page.waitForFunction(()=>activeAnimeTimeline && document.querySelector('#animeTimelineModal.open'));
      assert.equal(await page.evaluate(()=>currentUser),null);
      await context.grantPermissions(['clipboard-write','clipboard-read']);
      await page.getByRole('button',{name:'Compartir mapa',exact:true}).click();
      const copied=await page.evaluate(()=>navigator.clipboard.readText());
      assert.equal(copied,base+'?saga=52991');
      await page.screenshot({path:`/tmp/neoanimez-share-${name}.png`});
      await page.locator('#animeTimelineGrid [data-timeline-node-id]').first().click();
      await page.locator('#animeModal .modal-close').click();
      assert.equal(await page.locator('#animeTimelineModal').evaluate(n=>n.classList.contains('is-suspended')),false);
      await page.locator('.timeline-close').click();
      assert.equal(new URL(page.url()).searchParams.has('saga'),false);
      await page.locator('#animeModal .modal-close').click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      assert.deepEqual(errors,[],`${name}: JS errors`);
      console.log(`PASS ${name}: stable +/- and visit order; episodes; songs; recommendations; shared map and close/return`);
      await context.close();
    }
    // Simulated extras outage: catalogue/modal stay usable and retry works in place.
    const context=await browser.newContext();const page=await context.newPage();
    let fail=true;
    await page.route('**/anime-extras/*.json*',route=>fail?route.fulfill({status:503,body:'Temporary test failure'}):route.continue());
    await enter(page);
    await page.evaluate(()=>openAnimeModal(getAnimeById(52991)));
    await page.locator('[data-extra="themes"] summary').click();
    await page.locator('[data-extra="themes"] .load-retry-btn').waitFor();
    fail=false;await page.locator('[data-extra="themes"] .load-retry-btn').click();
    await page.locator('.extra-song-columns li').first().waitFor();
    await page.locator('#animeModal .modal-close').click();
    await context.close();
    console.log('PASS optional-data outage + retry without refresh');
    const bare=await browser.newContext();const barePage=await bare.newPage();
    await barePage.route('**/assets/anime-extras.js*',route=>route.fulfill({status:503,body:''}));
    const bareErrors=[];barePage.on('pageerror',error=>bareErrors.push(error.message));
    await enter(barePage);await barePage.evaluate(()=>openAnimeModal(getAnimeById(20)));
    await barePage.locator('#animeModal .modal-close').click();
    assert.deepEqual(bareErrors,[]);await bare.close();
    console.log('PASS missing optional script does not break catalogue/modal');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.kill());
