const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/neoanimez.js'), 'utf8');
const names = ['openAnimeFromTimeline','resumeAnimeTimeline','closeAnimeTimeline','openAnimeTimeline',
  'openAnimeModal','closeAnimeModal','resetAnimeModalScroll'];
const functions = names.map(name => source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');

function element(classes = []) {
  const list = new Set(classes);
  return {scrollTop:0,scrollLeft:0,inert:false,attributes:{},style:{},
    classList:{contains:key=>list.has(key),add:(...keys)=>keys.forEach(k=>list.add(k)),remove:(...keys)=>keys.forEach(k=>list.delete(k)),
      toggle(key,on){if(on)list.add(key);else list.delete(key);}},
    setAttribute(key,value){this.attributes[key]=value;},
    focus(options){this.focused=options;},
    scrollTo({top,left}){this.scrollTop=top;this.scrollLeft=left;}};
}
function setup() {
  const parent={mal_id:1,title:'Parent'},child={mal_id:2,title:'Child'};
  const timeline=element(['open']),modal=element(['open']),sheet=element(),close=element(),mapClose=element(),node=element();
  const viewport=element();viewport.scrollLeft=684;viewport.scrollTop=124;sheet.scrollTop=320;
  modal.querySelector=selector=>selector==='.modal-sheet'?sheet:selector==='.modal-close'?close:null;
  timeline.querySelector=()=>mapClose;
  const elements={animeTimelineModal:timeline,animeTimelineViewport:viewport,animeModal:modal,animeModalImg:element()};
  const frames=[],events=[];
  const ctx={document:{body:{style:{overflow:'hidden'}},getElementById:id=>elements[id]||null,querySelector(selector){
    if(selector==='#animeModal .modal-sheet')return sheet;
    if(selector==='#animeModal .modal-close')return close;
    if(selector.startsWith('#animeTimelineGrid'))return node;
    if(selector.includes('.modal-backdrop.open'))return modal.classList.contains('open')?modal:selector.includes('.timeline-backdrop.open')&&timeline.classList.contains('open')?timeline:null;
    return null;
  }},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame:()=>{},window:{clearTimeout:()=>{}},
    currentModalAnime:parent,currentRecommendationReason:'Original recommendation',currentUser:null,BLANK:'',
    activeAnimeTimeline:{id:'saga'},activeAnimeTimelineCurrentId:1,activeAnimeTimelineNodes:new Map([[1,parent],[2,child]]),
    activeAnimeTimelineDisplayEdges:[{from:1,to:2}],activeAnimeTimelineNarrativeIds:new Set([1,2]),animeTimelineMode:'all',
    animeTimelineDetailReturn:null,animeTimelineDrawFrame:0,animeTimelineResizeTimer:0,splitCatalogEnabled:false,
    isAnimeVisible:a=>!a.hidden,loadAnimeImageElement:()=>{},renderAnimeModalContent:a=>events.push(`render:${a.mal_id}`),
    renderAnimeRelationsForModal:()=>{},setModalStatusMessage:()=>{},trackProductEvent:name=>events.push(name),
    updateModalStatusUI:()=>{},updateModalRatingUI:()=>{},updateModalProgressUI:()=>{},clearAnimeRelationsUI:()=>{},
    updateAnimeTimelineScrollProgress:()=>events.push('scroll-progress'),closeAnimeRouteChooser:()=>events.push('close-routes')};
  vm.createContext(ctx);vm.runInContext(functions,ctx);
  const flush=()=>{let count=0;while(frames.length){assert.ok(++count<30);frames.shift()();}};
  return{ctx,parent,child,timeline,modal,sheet,close,node,viewport,events,flush};
}

test('opening a map card suspends but does not destroy the graph or change its mode',()=>{
  const {ctx,child,timeline,modal,close}=setup();const graph=ctx.activeAnimeTimeline;
  ctx.openAnimeFromTimeline(child);
  assert.equal(ctx.activeAnimeTimeline,graph);assert.equal(ctx.animeTimelineMode,'all');
  assert.equal(ctx.currentModalAnime,child);assert.equal(timeline.classList.contains('open'),true);
  assert.equal(timeline.classList.contains('is-suspended'),true);assert.equal(timeline.inert,true);assert.equal(modal.inert,false);
  assert.equal(close.attributes['aria-label'],'Cerrar ficha y volver al mapa');
});
test('closing the child restores the parent, map scroll and focus without double-counting an anime open',()=>{
  const {ctx,parent,child,timeline,modal,sheet,node,viewport,events,flush}=setup();
  ctx.openAnimeFromTimeline(child);flush();ctx.closeAnimeModal();flush();
  assert.equal(ctx.currentModalAnime,parent);assert.equal(ctx.currentRecommendationReason,'Original recommendation');
  assert.equal(ctx.animeTimelineDetailReturn,null);assert.equal(ctx.animeTimelineMode,'all');
  assert.equal(timeline.classList.contains('is-suspended'),false);assert.equal(timeline.inert,false);assert.equal(modal.inert,true);
  assert.equal(viewport.scrollLeft,684);assert.equal(viewport.scrollTop,124);assert.equal(sheet.scrollTop,320);
  assert.equal(node.focused.preventScroll,true);assert.equal(ctx.document.body.style.overflow,'hidden');
  assert.deepEqual(events.filter(e=>e==='anime_open'),['anime_open']);
});
test('closing the map after returning leaves the original anime usable; closing it then unlocks the page',()=>{
  const {ctx,child,modal,timeline,flush}=setup();ctx.openAnimeFromTimeline(child);ctx.closeAnimeModal();flush();ctx.closeAnimeTimeline();
  assert.equal(modal.classList.contains('open'),true);assert.equal(modal.inert,false);assert.equal(timeline.classList.contains('open'),false);
  assert.equal(ctx.activeAnimeTimeline,null);assert.equal(ctx.document.body.style.overflow,'hidden');
  ctx.closeAnimeModal();flush();assert.equal(ctx.document.body.style.overflow,'');assert.equal(ctx.currentModalAnime,null);
});
test('following another anime inside the child retains the original map return point',()=>{
  const {ctx,child,parent,flush}=setup();ctx.openAnimeFromTimeline(child);const context=ctx.animeTimelineDetailReturn;
  ctx.openAnimeModal({mal_id:3,title:'Next season'});assert.equal(ctx.animeTimelineDetailReturn,context);
  ctx.closeAnimeModal();flush();assert.equal(ctx.currentModalAnime,parent);
});
test('the map button in a child returns to the same map instead of resetting it',async()=>{
  const {ctx,child,timeline,viewport,flush}=setup();const graph=ctx.activeAnimeTimeline;
  ctx.openAnimeFromTimeline(child);await ctx.openAnimeTimeline(child);flush();
  assert.equal(ctx.activeAnimeTimeline,graph);assert.equal(ctx.animeTimelineMode,'all');assert.equal(viewport.scrollLeft,684);
  assert.equal(timeline.classList.contains('is-suspended'),false);
});
test('registration and home can explicitly leave both overlays without restoring the map',()=>{
  const {ctx,child,modal,timeline,flush}=setup();ctx.openAnimeFromTimeline(child);ctx.closeAnimeModal({returnToTimeline:false});flush();
  assert.equal(ctx.animeTimelineDetailReturn,null);assert.equal(ctx.activeAnimeTimeline,null);
  assert.equal(modal.classList.contains('open'),false);assert.equal(timeline.classList.contains('open'),false);assert.equal(ctx.document.body.style.overflow,'');
  assert.match(source,/function goHome\(\)[^]*?closeAnimeModal\(\{ returnToTimeline: false \}\)/);
  assert.match(source,/async function addCurrentAnimeToList\(\)[^]*?closeAnimeModal\(\{ returnToTimeline: false \}\)/);
});
test('closing the map before a queued restoration prevents stale scroll or focus changes',()=>{
  const {ctx,child,node,viewport,flush}=setup();ctx.openAnimeFromTimeline(child);ctx.closeAnimeModal();ctx.closeAnimeTimeline();
  viewport.scrollLeft=0;flush();assert.equal(viewport.scrollLeft,0);assert.equal(node.focused,undefined);
});
test('a second child opened immediately is not overwritten by an earlier restoration frame',()=>{
  const {ctx,child,modal,flush}=setup();ctx.openAnimeFromTimeline(child);ctx.closeAnimeModal();
  const next={mal_id:3,title:'Another child'};ctx.openAnimeFromTimeline(next);flush();
  assert.equal(ctx.currentModalAnime,next);assert.equal(modal.inert,false);
});
test('hidden anime and closed maps cannot create a dangling return context',()=>{
  const {ctx,timeline}=setup();ctx.openAnimeFromTimeline({mal_id:5,hidden:true});assert.equal(ctx.animeTimelineDetailReturn,null);
  timeline.classList.remove('open');ctx.openAnimeFromTimeline({mal_id:5});assert.equal(ctx.animeTimelineDetailReturn,null);
});
