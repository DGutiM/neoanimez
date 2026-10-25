const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/neoanimez.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const quiet = {log(){},warn(){},error(){}};
function scope(names, data) {
  const ctx = {console:quiet, Map, Set, ...data};
  vm.createContext(ctx);
  vm.runInContext(names.map(name => {
    const fn = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'));
    assert.ok(fn, name);
    return fn[0];
  }).join('\n'), ctx);
  return ctx;
}
function detailScope(fetch) {
  return scope(['loadAnimeDetails'], {
    splitCatalogEnabled:true, DB:[], detailBlockCache:new Map(),detailBlockRequests:new Map(),animeDetailCache:new Map(),
    getCatalogDetailFile:()=> 'anime-details/details-01.json',withCatalogVersion:p=>p,
    normalizeAnimeRecord:a=>a,fetchCatalogJson:fetch
  });
}
test('failed detail download is evicted; a second attempt succeeds', async()=>{
  let calls=0;
  const ctx=detailScope(async()=>{if(++calls===1)throw Error('offline');return {items:[{mal_id:1,description_es:'Completa'}]};});
  const anime={mal_id:1,title:'Uno'};
  const failed=await ctx.loadAnimeDetails(anime);
  assert.equal(failed._details_error,true);assert.equal(ctx.detailBlockRequests.size,0);
  const loaded=await ctx.loadAnimeDetails(failed);
  assert.equal(loaded._details_loaded,true);assert.equal(loaded._details_error,false);assert.equal(calls,2);
});
test('different anime in one block share a download, and cached blocks do not refetch',async()=>{
  let resolve,calls=0;
  const ctx=detailScope(()=>{calls++;return new Promise(r=>resolve=r);});
  const first=ctx.loadAnimeDetails({mal_id:1}),second=ctx.loadAnimeDetails({mal_id:25});
  assert.equal(calls,1);resolve({items:[{mal_id:1},{mal_id:25},{mal_id:49}]});
  await Promise.all([first,second]);await ctx.loadAnimeDetails({mal_id:49});assert.equal(calls,1);
});
test('a malformed detail block is not kept as a successful cache entry',async()=>{
  let calls=0;
  const ctx=detailScope(async()=>++calls===1?{items:[]}:{items:[{mal_id:1}]});
  assert.equal((await ctx.loadAnimeDetails({mal_id:1}))._details_error,true);
  assert.equal(ctx.detailBlockCache.size,0);
  assert.equal((await ctx.loadAnimeDetails({mal_id:1}))._details_loaded,true);
});
test('late detail response cannot replace a different anime currently open',async()=>{
  let rendered=false;
  const ctx=scope(['hydrateAnimeModalDetails'],{currentModalAnime:{mal_id:2},loadAnimeDetails:async()=>({mal_id:1}),renderAnimeModalContent:()=>rendered=true});
  await ctx.hydrateAnimeModalDetails({mal_id:1});assert.equal(rendered,false);
});
function scheduleScope(fetch) {
  return scope(['loadAnimeSchedule'],{animeScheduleLoadPromise:null,animeScheduleLoaded:false,animeScheduleError:false,
    animeSchedulePayload:null,SCHEDULE_URL:'schedule.json',fetchCatalogJson:fetch,renderUserSchedule(){}});
}
test('schedule requests are shared; a failure remains retryable',async()=>{
  let reject,calls=0;
  const ctx=scheduleScope(()=>{calls++;return new Promise((_,r)=>reject=r);});
  const first=ctx.loadAnimeSchedule(),second=ctx.loadAnimeSchedule();assert.equal(first,second);assert.equal(calls,1);
  reject(Error('offline'));assert.equal(await first,false);assert.equal(ctx.animeScheduleLoaded,false);assert.equal(ctx.animeScheduleError,true);
  ctx.fetchCatalogJson=async()=>({days:{monday:[]}});
  assert.equal(await ctx.loadAnimeSchedule(),true);assert.equal(ctx.animeScheduleError,false);
});
test('failed schedule refresh preserves the last usable calendar',async()=>{
  const ctx=scheduleScope(async()=>{throw Error('offline');});
  const previous={days:{monday:[]}};ctx.animeSchedulePayload=previous;ctx.animeScheduleLoaded=true;
  assert.equal(await ctx.loadAnimeSchedule({force:true}),false);
  assert.equal(ctx.animeSchedulePayload,previous);assert.equal(ctx.animeScheduleLoaded,true);
});
test('real schedule shape validates; invalid payloads stay retryable',async()=>{
  const payload=JSON.parse(fs.readFileSync(path.join(root,'anime-schedule.json'),'utf8'));
  const ctx=scheduleScope(async()=>payload);assert.equal(await ctx.loadAnimeSchedule(),true);
  ctx.fetchCatalogJson=async()=>({days:{monday:{}}});assert.equal(await ctx.loadAnimeSchedule({force:true}),false);
  assert.equal(ctx.animeSchedulePayload,payload);
});
function catalogScope(fetch) {
  return scope(['loadDB','catalogUnavailableMarkup'],{DB:[],catalogLoading:false,splitCatalogEnabled:false,
    CATALOG_INDEX_URL:'index',CATALOG_FALLBACK_URL:'full',fetchCatalogJson:fetch,normalizeAnimeRecord:a=>a,
    detailBlockCache:new Map(),detailBlockRequests:new Map(),animeDetailCache:new Map(),document:{getElementById:()=>null}});
}
test('invalid lightweight catalogue falls back to the full local catalogue',async()=>{
  const calls=[];const ctx=catalogScope(async file=>{calls.push(file);return file==='index'?{}:[{mal_id:1}];});
  assert.equal(await ctx.loadDB(),true);assert.deepEqual(calls,['index','full']);assert.equal(ctx.splitCatalogEnabled,false);
});
test('catalogue failure returns false without pretending it is an empty successful catalogue',async()=>{
  const ctx=catalogScope(async()=>[]);assert.equal(await ctx.loadDB(),false);assert.equal(ctx.DB.length,0);
});
test('loading and failed states offer appropriate feedback without requiring a page refresh',()=>{
  const ctx=catalogScope(async()=>[]);
  assert.match(ctx.catalogUnavailableMarkup(),/Reintentar carga/);
  ctx.catalogLoading=true;assert.match(ctx.catalogUnavailableMarkup(),/Cargando/);assert.doesNotMatch(ctx.catalogUnavailableMarkup(),/<button/);
});
test('catalogue retry is deduplicated and restores search, lists and selected filters',async()=>{
  let resolve;const events=[];
  const ctx=scope(['loadCatalogInterface'],{catalogLoadPromise:null,currentUser:{id:'fake'},catalogFilterRequested:true,rankingLoaded:true,upcomingPayload:{},
    document:{getElementById:()=>({value:'frieren'})},loadDB:()=>new Promise(r=>resolve=r),
    setDiscoveryLoading:v=>events.push(v?'loading':'ready'),renderDiscoveryShelf:()=>events.push('shelf'),updateAdultContentUI(){},
    renderUserLists:()=>events.push('list'),applyFilters:()=>events.push('filters'),performTitleSearch:()=>events.push('search'),
    renderCommunityRanking:()=>events.push('ranking'),loadUpcomingRanking:async()=>events.push('upcoming')});
  const first=ctx.loadCatalogInterface();assert.equal(ctx.loadCatalogInterface(),first);
  resolve(true);assert.equal(await first,true);assert.equal(ctx.catalogLoadPromise,null);
  for(const event of ['shelf','list','filters','search','ranking','upcoming'])assert.ok(events.includes(event));
});
test('form bindings precede the first bootstrap await; authentication does not wait for the catalogue',()=>{
  const boot=source.slice(source.indexOf("document.addEventListener('DOMContentLoaded', async () =>"));
  const firstAwait=boot.indexOf('await ');
  for(const id of ['loginForm','signupForm','changePasswordForm'])assert.ok(boot.indexOf(`getElementById('${id}')?.addEventListener('submit'`)<firstAwait);
  assert.ok(boot.indexOf("searchForm.addEventListener('submit'")<firstAwait);
  assert.match(boot,/await Promise\.all\(\[catalogReady, syncAuthState\(\)\]\)/);
});
test('corrupt stored JSON is discarded instead of poisoning future loads',async()=>{
  let deleted=false,written=false;
  const cache={match:async()=>({json:async()=>{throw Error('bad JSON');}}),delete:async()=>deleted=true,put:async()=>written=true};
  const response={ok:true,clone:()=>({json:async()=>({items:[1]})})};
  const ctx=scope(['fetchCatalogJson'],{getRuntimeCache:async()=>cache,fetch:async()=>response,withTimeout:p=>p});
  const result=await ctx.fetchCatalogJson('file',{preferCache:true});assert.equal(result.items[0],1);assert.equal(deleted,true);assert.equal(written,true);
});
test('invalid network JSON is never persisted over a good cached response',async()=>{
  let writes=0;
  const cache={match:async()=>({json:async()=>({items:[1]})}),put:async()=>writes++};
  const ctx=scope(['fetchCatalogJson'],{getRuntimeCache:async()=>cache,withTimeout:p=>p,
    fetch:async()=>({ok:true,clone:()=>({json:async()=>{throw Error('bad');}})})});
  const result=await ctx.fetchCatalogJson('file');assert.equal(result.items[0],1);assert.equal(writes,0);
});
test('catalogue cards support Enter and Space without hijacking child controls or held keys',()=>{
  const attrs={},handlers={};let clicks=0,prevented=0;
  const card={setAttribute:(k,v)=>attrs[k]=v,addEventListener:(k,v)=>handlers[k]=v,click:()=>clicks++};
  const ctx=scope(['makeAnimeCardAccessible'],{});ctx.makeAnimeCardAccessible(card,'Anime');
  assert.equal(card.tabIndex,0);assert.equal(attrs.role,'button');assert.equal(attrs['aria-label'],'Abrir ficha de Anime');
  for(const key of ['Enter',' '])handlers.keydown({key,target:card,preventDefault:()=>prevented++});
  handlers.keydown({key:'Enter',target:{}});handlers.keydown({key:'Enter',target:card,repeat:true});
  assert.equal(clicks,2);assert.equal(prevented,2);
});
test('dialog focus cycles within the topmost open window',()=>{
  let focused=null,prevented=0;
  const first={closest:()=>null,getClientRects:()=>[{}],focus:()=>focused='first'};
  const last={...first,focus:()=>focused='last'};
  const dialog={querySelectorAll:()=>[first,last],contains:el=>[first,last].includes(el)};
  const doc={activeElement:last,querySelector:s=>s==='#animeRouteModal.open'?dialog:null};
  const ctx=scope(['trapOpenDialogFocus'],{document:doc});
  ctx.trapOpenDialogFocus({key:'Tab',preventDefault:()=>prevented++});assert.equal(focused,'first');
  doc.activeElement=first;ctx.trapOpenDialogFocus({key:'Tab',shiftKey:true,preventDefault:()=>prevented++});assert.equal(focused,'last');assert.equal(prevented,2);
});
test('explicit catalogue search scrolls, normal re-renders do not',async()=>{
  const events=[];
  const ctx=scope(['applyFilters'],{DB:[{mal_id:1,type:'OVA'}],document:{getElementById:()=>({value:'',innerHTML:''})},
    getSelectedGenres:()=>[],getSelectedThemes:()=>[],isAnimeVisible:()=>true,sortAnimeResults:a=>a,
    updateResultsSummary(){},renderCatalogBatch(){},scrollToCatalogResults:()=>events.push('scroll')});
  await ctx.applyFilters();assert.equal(events.length,0);await ctx.applyFilters({scrollToResults:true});assert.equal(events.length,1);
});
test('format selector exposes catalogue formats and all retry actions are buttons',()=>{
  for(const type of ['TV','Movie','OVA','ONA','Special','TV Special'])assert.ok(html.includes(`<option value="${type}">`));
  assert.match(html,/id="catalogRetry"[^>]+type="button"/);assert.match(html,/id="animeDetailsFeedback"[^>]+role="status"/);
  assert.match(source,/const scoreValue = anime.score != null/);
});
test('finishing a save does not enable episode buttons blocked by zero or the episode limit',()=>{
  const buttons=[true,false,true].map(blocked=>({dataset:{progressBlocked:String(blocked)},classList:{toggle(){}}}));
  const ctx=scope(['setElementsBusy'],{document:{querySelectorAll:()=>buttons}});
  ctx.setElementsBusy('steps',true);assert.ok(buttons.every(button=>button.disabled));
  ctx.setElementsBusy('steps',false);assert.deepEqual(buttons.map(button=>button.disabled),[true,false,true]);
  assert.equal((source.match(/data-progress-blocked="\$\{!can(?:Decrement|Increment)Episode\}"/g)||[]).length,4);
});

function releaseScope(current = []) {
  const now = Date.UTC(2026, 9, 25, 12);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  return scope(['isUpcomingAnime','getAnimeReleaseStatusLabel','getAnimeById','getCurrentUpcomingAnime'],{
    Date:FixedDate, DB:current, upcomingAnimeMap:new Map()
  });
}
test('canonical airing and finished records remove stale upcoming entries without mutating data',()=>{
  const current=[{mal_id:1,airing_status:'Currently Airing',ongoing:true},{mal_id:2,airing_status:'Finished Airing'}];
  const ctx=releaseScope(current);
  for(const anime of current)ctx.upcomingAnimeMap.set(anime.mal_id,{mal_id:anime.mal_id,airing_status:'Not yet aired',aired_from:'2027-01-01'});
  const before=JSON.stringify({current,cached:[...ctx.upcomingAnimeMap.values()]});
  assert.equal(ctx.getCurrentUpcomingAnime(1),null);assert.equal(ctx.getCurrentUpcomingAnime(2),null);
  assert.equal(JSON.stringify({current,cached:[...ctx.upcomingAnimeMap.values()]}),before);
});
test('upcoming retains future and undated announcements but excludes elapsed dates and cancellations',()=>{
  const ctx=releaseScope();
  const items=[
    {mal_id:1,airing_status:'Not yet aired',aired_from:'2026-11-01'},
    {mal_id:2,airing_status:'Not yet aired'},
    {mal_id:3,airing_status:'Not yet aired',aired_from:'2026-10-25'},
    {mal_id:4,airing_status:'Cancelled',aired_from:'2027-01-01'}
  ];
  for(const anime of items)ctx.upcomingAnimeMap.set(anime.mal_id,anime);
  assert.equal(ctx.getCurrentUpcomingAnime(1).mal_id,1);assert.equal(ctx.getCurrentUpcomingAnime(2).mal_id,2);
  assert.equal(ctx.getCurrentUpcomingAnime(3),null);assert.equal(ctx.getCurrentUpcomingAnime(4),null);
  assert.equal(ctx.getCurrentUpcomingAnime(999),null);
});
test('catalogue premiere metadata supersedes a stale upcoming date',()=>{
  const ctx=releaseScope([{mal_id:1,airing_status:'Not yet aired',aired_from:'2026-10-25'}]);
  ctx.upcomingAnimeMap.set(1,{mal_id:1,airing_status:'Not yet aired',aired_from:'2027-01-01',title:'Anime'});
  assert.equal(ctx.getCurrentUpcomingAnime(1),null);
});
test('release label distinguishes aired from confirmed finished and respects cancellations',()=>{
  const ctx=releaseScope();
  for(const [anime,label] of [
    [{airing_status:'Not yet aired',aired_from:'2026-11-01'},'Próximo estreno'],
    [{airing_status:'Not yet aired',aired_from:'2026-10-25',ongoing:false},'Estrenado'],
    [{airing_status:'Currently Airing'},'En emisión'],
    [{airing_status:'Finished Airing'},'Finalizado'],
    [{airing_status:'Cancelled',aired_from:'2027-01-01'},'Cancelado']
  ])assert.equal(ctx.getAnimeReleaseStatusLabel(anime),label);
});
test('opening upcoming revalidates its contents; closing it and other sections do not',()=>{
  let calls=0;
  function toggle(target) {
    let open=false;
    const group={classList:{contains:()=>open,toggle:()=>open=!open}};
    return {dataset:{target},closest:()=>group,setAttribute(){},addEventListener(_,handler){this.click=handler;}};
  }
  const upcoming=toggle('rankingUpcomingList'),other=toggle('rankingCommunityList');
  const ctx=scope(['initRankingAccordions'],{document:{querySelectorAll:()=>[upcoming,other]},loadUpcomingRanking:async()=>{calls++;}});
  ctx.initRankingAccordions();upcoming.click();assert.equal(calls,1);
  upcoming.click();other.click();assert.equal(calls,1);
  upcoming.click();assert.equal(calls,2);
});
