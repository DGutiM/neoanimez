const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/neoanimez.js'), 'utf8');
const names = ['renderAuthContext','switchAuthTab','updateDiscoverySearchMode','performTitleSearch',
  'showRecommendationUnavailable','openRandomRecommendation','openMoodRecommendation','openTasteRecommendation'];
const functions = names.map(name => {
  const match = source.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, name);
  return match[0];
}).join('\n');

function element() {
  const classes = new Set();
  return {value:'',hidden:false,textContent:'',innerHTML:'',attributes:{},
    classList:{contains:key=>classes.has(key),toggle(key,on){if(on)classes.add(key);else classes.delete(key);}},
    setAttribute(key,value){this.attributes[key]=value;}};
}
function setup() {
  const ids=['authContextTitle','authContextText','authPendingAnime','authTabLogin','authTabSignup','loginForm','signupForm',
    'discoveryExplore','titleSearchInput','titleSearchResults','recommendationFeedback','randomAnimeButton','tasteAnimeButton'];
  const elements=Object.fromEntries(ids.map(id=>[id,element()]));
  const events=[],opened=[];
  const anime={mal_id:1,title:'Cowboy Bebop'};
  const ctx={
    document:{getElementById:id=>elements[id] || null},readPendingListIntent:()=>({title:'<Anime elegido>'}),setAuthFeedback:()=>{},
    DB:[anime],currentUser:{id:'test-only'},normalizeLoose:q=>q.trim().toLowerCase(),toggleSearchClearButton:()=>{},updateAccountModeUI:()=>{},
    updateSimpleSummary:()=>{},scrollToTitleSearchResults:()=>events.push('scroll'),isAnimeVisible:()=>true,
    scoreAnimeMatch:()=>400,getSearchDisplayTitle:a=>a.title,sortTitleSearchResults:r=>r,searchResultsCache:[],
    renderSearchBatch:()=>{elements.titleSearchResults.innerHTML='results';},trackProductEvent:name=>events.push(name),
    pickRandomAnime:pool=>pool[0],getRandomRecommendationPool:()=>[anime],getTasteRecommendationPool:()=>[anime],
    getMoodRecommendationPool:()=>[anime],MOOD_RECOMMENDATIONS:{short:{reason:'es breve'}},BLANK:'',
    rollRecommendationButton:(button,a,reason)=>opened.push({button,anime:a,reason}),
    openAnimeModal:(a,image,options)=>opened.push({anime:a,reason:options.recommendationReason})
  };
  vm.createContext(ctx);vm.runInContext(functions,ctx);
  return{ctx,elements,events,opened};
}

test('contextual registration and existing-account switch keep the chosen anime',()=>{
  const {ctx,elements}=setup();ctx.switchAuthTab('signup');
  assert.equal(elements.loginForm.classList.contains('hidden'),true);
  assert.equal(elements.signupForm.classList.contains('hidden'),false);
  assert.equal(elements.authTabSignup.attributes['aria-pressed'],'true');
  assert.match(elements.authContextTitle.textContent,/gratis/);
  assert.match(elements.authContextText.textContent,/Confirma el correo/);
  assert.equal(elements.authPendingAnime.textContent,'<Anime elegido>');
  ctx.switchAuthTab('login');
  assert.equal(elements.loginForm.classList.contains('hidden'),false);
  assert.equal(elements.authTabSignup.attributes['aria-pressed'],'false');
  assert.match(elements.authContextTitle.textContent,/Entra/);
  assert.equal(elements.authPendingAnime.textContent,'<Anime elegido>');
});
test('account copy without an intent does not promise an automatic save',()=>{
  const {ctx,elements}=setup();ctx.readPendingListIntent=()=>null;ctx.switchAuthTab('signup');
  assert.equal(elements.authPendingAnime.hidden,true);
  assert.equal(elements.authContextTitle.textContent,'Tu lista, siempre contigo');
  assert.match(elements.authContextText.textContent,/no requiere cuenta/);
});
test('live search shows results directly without scrolling or recording typed text',()=>{
  const {ctx,elements,events}=setup();elements.titleSearchInput.value='Cow';ctx.performTitleSearch();
  assert.equal(elements.discoveryExplore.hidden,true);
  assert.equal(elements.titleSearchResults.innerHTML,'results');
  assert.deepEqual(events,[]);
});
test('explicit search records a fixed event and scrolls; clearing restores discovery',()=>{
  const {ctx,elements,events}=setup();elements.titleSearchInput.value='Cow';ctx.performTitleSearch({scrollToResults:true});
  assert.deepEqual(events,['search_submitted','scroll']);
  elements.titleSearchInput.value='';ctx.performTitleSearch();
  assert.equal(elements.discoveryExplore.hidden,false);assert.equal(elements.titleSearchResults.innerHTML,'');
});
test('one-letter, empty and failed-catalogue searches stay usable',()=>{
  const {ctx,elements,events}=setup();elements.titleSearchInput.value='c';ctx.performTitleSearch();
  assert.equal(elements.discoveryExplore.hidden,false);assert.match(elements.titleSearchResults.innerHTML,/2 letras/);
  ctx.DB=[];elements.titleSearchInput.value='Cow';ctx.performTitleSearch({scrollToResults:true});
  assert.match(elements.titleSearchResults.innerHTML,/no est/);assert.deepEqual(events,['scroll']);
});
test('zero matches leaves the clear button/search workflow intact',()=>{
  const {ctx,elements}=setup();ctx.scoreAnimeMatch=()=>0;elements.titleSearchInput.value='nomatch';ctx.performTitleSearch();
  assert.equal(elements.discoveryExplore.hidden,true);assert.match(elements.titleSearchResults.innerHTML,/No encontr/);
});
test('recommendation feedback is nearby text and never replaces search results',()=>{
  const {ctx,elements}=setup();elements.titleSearchResults.innerHTML='existing results';ctx.showRecommendationUnavailable('<test>');
  assert.equal(elements.recommendationFeedback.textContent,'<test>');assert.equal(elements.recommendationFeedback.hidden,false);
  assert.equal(elements.titleSearchResults.innerHTML,'existing results');
  ctx.showRecommendationUnavailable('');assert.equal(elements.recommendationFeedback.hidden,true);
});
for (const [method,event] of [['openRandomRecommendation','recommendation_surprise'],['openTasteRecommendation','recommendation_personal'],['openMoodRecommendation','recommendation_mood']]) {
  test(`${method} opens the existing anime modal and records only a fixed event`,()=>{
    const {ctx,opened,events}=setup();ctx[method]('short');
    assert.equal(opened[0].anime.mal_id,1);assert.deepEqual(events,[event]);
  });
}
test('empty recommendations give feedback without opening an empty modal',()=>{
  const {ctx,elements,opened}=setup();ctx.getRandomRecommendationPool=()=>[];ctx.openRandomRecommendation();
  assert.equal(opened.length,0);assert.equal(elements.recommendationFeedback.hidden,false);
  ctx.getTasteRecommendationPool=()=>[];ctx.openTasteRecommendation();assert.match(elements.recommendationFeedback.textContent,/lista/);
});
test('search, grouped recommendations and labels match the new hierarchy',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(html.indexOf('id="titleSearchForm"')<html.indexOf('id="discoveryExplore"'));
  assert.ok(html.indexOf('id="randomAnimeButton"')<html.indexOf('id="discoveryCovers"'));
  assert.match(html,/<details class="mood-panel" id="moodRecommendationPanel">/);
  assert.match(html,/id="nav-ranking"[^]*?Destacados\s*<\/button>/);
  assert.match(html,/ranking-toggle-title">Top Comunidad/);
  assert.match(html,/id="titleSearchForm" role="search"/);
  assert.match(html,/id="searchResultsSummary" role="status"/);
});
