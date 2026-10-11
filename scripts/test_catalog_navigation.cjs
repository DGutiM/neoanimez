const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/neoanimez.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const functions = ['getSelectedGenres', 'getSelectedThemes', 'updateCatalogFilterUI', 'applyFilters', 'setActiveScreen']
  .map(name => source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');

function element(id, classNames = []) {
  const classes = new Set(classNames);
  return {id, value:'', hidden:false, textContent:'', innerHTML:'', attributes:{},
    classList:{contains:name=>classes.has(name), add:(...names)=>names.forEach(n=>classes.add(n)),
      remove:(...names)=>names.forEach(n=>classes.delete(n)), toggle:(name,on)=>on?classes.add(name):classes.delete(name)},
    setAttribute(name,value){this.attributes[name]=value;}, removeAttribute(name){delete this.attributes[name];}};
}
function setup() {
  const selects = [element('f-genre',['genre-select']), element('f-type'), element('f-theme',['theme-select']), element('f-demo'), element('f-year')];
  const ids = Object.fromEntries(selects.map(e=>[e.id,e]));
  ['catalogFilters','catalogAdvancedFilters','advancedFilterCount','resetCatalogFilters','filterResults'].forEach(id=>ids[id]=element(id));
  ids.catalogFilters.querySelectorAll=()=>selects;
  ids.catalogAdvancedFilters.querySelectorAll=()=>selects.filter(e=>e.id==='f-demo'||e.id==='f-year'||e.classList.contains('theme-select'));
  const nav=['search','filter','user','ranking','info'].map(name=>element(`nav-${name}`,name==='search'?['nbtn','active']:['nbtn']));
  const screens=['search','filter','user','ranking','info'].map(name=>element(`${name}-screen`,name==='search'?['screen','active']:['screen']));
  [...nav,...screens].forEach(e=>ids[e.id]=e);
  const ctx={document:{getElementById:id=>ids[id],querySelectorAll(selector){
    if(selector==='.nbtn')return nav;
    if(selector==='.screen')return screens;
    if(selector==='.genre-select')return selects.filter(e=>e.classList.contains('genre-select'));
    if(selector==='.theme-select')return selects.filter(e=>e.classList.contains('theme-select'));
    if(selector==='#genreFilters .genre-row, #themeFilters .theme-row')return selects.filter(e=>e.classList.contains('genre-select')||e.classList.contains('theme-select'));
    return [];
  }},DB:[],catalogResultsCache:[],isAnimeVisible:a=>!a.adult,sortAnimeResults:r=>r,
    updateResultsSummary:count=>ctx.count=count,renderCatalogBatch:()=>{},
    activeScreenName:'search',lastScreenName:'',saveScreenScrollPosition:()=>{},scheduleHeavyScreenReset:()=>{},
    persistActiveScreen:()=>{},flushPendingScreenResets:()=>{},flushBackgroundScreenResets:()=>{},restoreScreenScrollPosition:()=>{},window:{innerWidth:1200}};
  vm.createContext(ctx); vm.runInContext(functions,ctx);
  return {ctx,ids,selects,nav,screens};
}

test('new navigation has a stable order with My List in the centre',()=>{
  const nav=html.match(/<nav[^>]*>([^]*?)<\/nav>/)[1];
  assert.deepEqual([...nav.matchAll(/id="nav-([^"]+)"/g)].map(m=>m[1]),['search','filter','user','ranking','info']);
  assert.equal((nav.match(/aria-current="page"/g)||[]).length,1);
});
test('advanced filters start closed, remain in the form, and keep every original option',()=>{
  assert.match(html,/<details class="filter-advanced" id="catalogAdvancedFilters">/);
  const form=html.match(/<form id="catalogFilters"[^]*?<\/form>/)[0];
  assert.deepEqual([...form.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/g)]
    .map(m=>[...m[1].matchAll(/<option\b/g)].length),[21,3,41,6,6]);
  assert.ok(form.indexOf('id="f-genre"')<form.indexOf('<details'));
  assert.ok(form.indexOf('id="f-type"')<form.indexOf('<details'));
  for(const id of ['f-theme','f-demo','f-year']) assert.ok(form.indexOf(`id="${id}"`)>form.indexOf('<details'));
  assert.match(form,/<label for="f-year">Década<\/label>/);
  assert.match(form,/<button class="apply-btn" type="submit">/);
  assert.match(source,/select\.removeAttribute\('id'\)/);
});
test('empty filters show no badge and cannot be reset',()=>{
  const {ctx,ids}=setup();ctx.updateCatalogFilterUI();
  assert.equal(ids.advancedFilterCount.hidden,true);assert.equal(ids.resetCatalogFilters.disabled,true);
});
test('advanced badge counts unique active filters even while collapsed',()=>{
  const {ctx,ids,selects}=setup();ids['f-theme'].value='Isekai';ids['f-demo'].value='Shounen';
  const duplicate=element('', ['theme-select']);duplicate.value='Isekai';selects.push(duplicate);
  ctx.updateCatalogFilterUI();
  assert.equal(ids.advancedFilterCount.textContent,'2 activos');assert.equal(ids.advancedFilterCount.hidden,false);
  assert.equal(ids['f-theme'].classList.contains('has-value'),true);assert.equal(ids.resetCatalogFilters.disabled,false);
  ids['f-theme'].value='';duplicate.value='';ctx.updateCatalogFilterUI();assert.equal(ids.advancedFilterCount.textContent,'1 activo');
});
test('genre and type enable reset but do not count as hidden advanced filters',()=>{
  const {ctx,ids}=setup();ids['f-genre'].value='Action';ids['f-type'].value='TV';ctx.updateCatalogFilterUI();
  assert.equal(ids.advancedFilterCount.hidden,true);assert.equal(ids.resetCatalogFilters.disabled,false);
});
test('extra empty rows can be cleared; removing them clears the selected style',()=>{
  const {ctx,ids,selects}=setup();selects.push(element('', ['genre-select']));ctx.updateCatalogFilterUI();
  assert.equal(ids.resetCatalogFilters.disabled,false);selects.pop();
  ids['f-demo'].value='Josei';ctx.updateCatalogFilterUI();ids['f-demo'].value='';ctx.updateCatalogFilterUI();
  assert.equal(ids.resetCatalogFilters.disabled,true);assert.equal(ids['f-demo'].classList.contains('has-value'),false);
});
test('all five filter types still combine with AND semantics',async()=>{
  const {ctx,ids}=setup();
  const match={mal_id:1,genres:['Action','Fantasy'],themes:['Isekai'],type:'TV',demographic:'Shounen',year:2024};
  ctx.DB=[match,{...match,mal_id:2,genres:['Action']},{...match,mal_id:3,themes:[]},{...match,mal_id:4,type:'Movie'},
    {...match,mal_id:5,demographic:'Seinen'},{...match,mal_id:6,year:1990},{...match,mal_id:7,adult:true}];
  ids['f-genre'].value='Fantasy';ids['f-theme'].value='Isekai';ids['f-type'].value='TV';ids['f-demo'].value='Shounen';ids['f-year'].value='2020s';
  await ctx.applyFilters();assert.deepEqual(Array.from(ctx.catalogResultsCache,a=>a.mal_id),[1]);
});
test('decade boundaries and unknown years preserve catalogue behaviour',async()=>{
  const {ctx,ids}=setup();ctx.DB=[1989,1990,1999,2000,2009,2010,2019,2020,2029,2030,0].map(year=>({year}));
  for(const [decade,expected] of [['classic',[1989]],['1990s',[1990,1999]],['2000s',[2000,2009]],['2010s',[2010,2019]],['2020s',[2020,2029]]]){
    ids['f-year'].value=decade;await ctx.applyFilters();assert.deepEqual(Array.from(ctx.catalogResultsCache,a=>a.year),expected);
  }
});
test('unavailable catalogue and empty matches give feedback',async()=>{
  const {ctx,ids}=setup();await ctx.applyFilters();assert.match(ids.filterResults.innerHTML,/todavía no está lista/);
  ctx.DB=[{genres:['Action']}];ids['f-genre'].value='Comedy';await ctx.applyFilters();assert.match(ids.filterResults.innerHTML,/Sin resultados/);
});
test('navigation marks exactly the selected section, including a signed-in My List',()=>{
  const {ctx,nav}=setup();nav[2].classList.add('user-active');
  for(const name of ['filter','user','ranking','info','search']){
    ctx.setActiveScreen(`${name}-screen`,`nav-${name}`);
    assert.deepEqual(nav.filter(e=>e.classList.contains('active')).map(e=>e.id),[`nav-${name}`]);
    assert.deepEqual(nav.filter(e=>e.attributes['aria-current']==='page').map(e=>e.id),[`nav-${name}`]);
  }
});
