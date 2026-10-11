const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/neoanimez.js'), 'utf8');
const names = ['getInitialScreen', 'validateListIntent', 'readPendingListIntent', 'writePendingListIntent', 'bindListIntentToEmail', 'addCurrentAnimeToList', 'resumePendingListIntent', 'trackProductEvent', 'bootstrapAuthFromUrl'];
const functions = names.map(name => {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, name);
  return match[0];
}).join('\n');
function setup(overrides = {}) {
  const storage = new Map();
  const calls = [];
  const anime = { mal_id: 1, title: 'Cowboy Bebop' };
  const ctx = {
    console, Date, URL, URLSearchParams, Map, Set,
    window: {location: {origin:'https://neoanimez.com',pathname:'/',search:'?code=secret',hash:'#access_token=secret'}},
    PENDING_LIST_INTENT_KEY: 'intent', LIST_INTENT_TTL: 604800000,
    pendingListIntentMemory: null, resumingListIntent: false,
    currentUser: null, currentModalAnime: anime, userAnimeMap: new Map(),
    isPasswordRecoveryFlow: false, pendingAuthNotice: '', analyticsLoaded: false,
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    screenScrollPositions: {},
    document: { getElementById: () => null, querySelector: () => ({ scrollIntoView: () => calls.push('scroll') }) },
    getAnimeDisplayTitle: a => a.title, getAnimeById: () => anime, isAnimeVisible: () => true,
    readPublicProfileSlugFromUrl: () => '', renderAuthContext: () => {},
    closeAnimeModal: () => calls.push('close'), openAnimeModal: () => calls.push('open'),
    switchAuthTab: tab => calls.push(`auth:${tab}`), showScreen: s => calls.push(s), setAuthFeedback: () => {},
    setModalStatusMessage: () => {}, updateModalStatusUI: () => {},
    saveAnimeStatus: async () => { calls.push('save'); return true; },
    fetchUserStatuses: async () => true, loadUpcomingRanking: async () => {},
    readCookieConsent: () => 'rejected', gtag: (...a) => calls.push(a),
    getAuthUrlState: () => ({ code: 'test', type: '' }),
    supabaseClient: { auth: { exchangeCodeForSession: async () => ({ data: { session: { user: { id: 'u1', recovery_sent_at: '2020-01-01' } } } }) } },
    setAuthFlashMessage: () => {}, ...overrides
  };
  vm.createContext(ctx); vm.runInContext(functions, ctx);
  return { ctx, storage, calls, anime };
}
function intent(ctx, email = 'test@example.invalid') {
  ctx.writePendingListIntent({ animeId: 1, title: 'Cowboy Bebop', createdAt: Date.now(), email });
}
test('visitors enter discovery; members and recovery enter account', () => {
  const {ctx} = setup();
  assert.equal(ctx.getInitialScreen(), 'search');
  for (const state of [{user:{id:'u1'}},{recovery:true},{passwordUpdated:true},{authRedirect:true}]) assert.equal(ctx.getInitialScreen(state), 'user');
});
test('pending intent rejects corrupt, expired, future and invalid IDs', () => {
  const {ctx} = setup(); const now = Date.now();
  for (const value of [null, {}, {animeId:-1}, {animeId:1,title:'x',createdAt:now-604800001}, {animeId:1,title:'x',createdAt:now+1}, {animeId:1,title:'x',createdAt:now,email:{}}]) assert.equal(ctx.validateListIntent(value,now),null);
});
test('corrupt storage does not throw', () => {
  const {ctx,storage} = setup(); storage.set('intent','{bad'); assert.equal(ctx.readPendingListIntent(),null);
});
test('storage unavailable still preserves intent within the tab', () => {
  const {ctx} = setup({localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}}});
  intent(ctx); assert.equal(ctx.readPendingListIntent().animeId,1);
});
test('guest save opens account and does not write data', async () => {
  const {ctx,calls} = setup(); await ctx.addCurrentAnimeToList();
  assert.equal(ctx.readPendingListIntent().animeId,1); assert.ok(calls.includes('user')); assert.ok(!calls.includes('save'));
  assert.ok(calls.includes('auth:signup'));
});
test('member adds directly; existing state is never replaced', async () => {
  const {ctx,calls} = setup({currentUser:{id:'u1'}}); await ctx.addCurrentAnimeToList(); assert.ok(calls.includes('save'));
  calls.length=0; ctx.userAnimeMap.set(1,'completed'); await ctx.addCurrentAnimeToList(); assert.deepEqual(calls,['scroll']);
});
test('intent survives another tab and binds only to the submitted email', () => {
  const {ctx,storage} = setup(); intent(ctx); ctx.bindListIntentToEmail(' New@Example.invalid ');
  ctx.pendingListIntentMemory=null; assert.equal(ctx.readPendingListIntent().email,'new@example.invalid'); assert.ok(storage.has('intent'));
});
test('confirmed matching account resumes once and clears saved intent', async () => {
  const {ctx,calls} = setup({currentUser:{id:'u1',email:'test@example.invalid'}}); intent(ctx);
  await Promise.all([ctx.resumePendingListIntent(),ctx.resumePendingListIntent()]);
  assert.equal(calls.filter(x=>x==='save').length,1); assert.equal(ctx.readPendingListIntent(),null);
});
test('existing completed anime keeps its state on resumption', async () => {
  const {ctx,calls} = setup({currentUser:{id:'u1',email:'test@example.invalid'}}); intent(ctx); ctx.userAnimeMap.set(1,'completed');
  await ctx.resumePendingListIntent(); assert.ok(!calls.includes('save')); assert.equal(ctx.userAnimeMap.get(1),'completed');
});
test('failed list fetch or failed save retains intent for retry', async () => {
  for (const override of [{fetchUserStatuses:async()=>false},{saveAnimeStatus:async()=>false}]) {
    const {ctx} = setup({currentUser:{id:'u1',email:'test@example.invalid'},...override}); intent(ctx); await ctx.resumePendingListIntent(); assert.ok(ctx.readPendingListIntent());
  }
});
test('different account, recovery and public list never auto-save', async () => {
  for (const override of [{currentUser:{id:'u2',email:'other@example.invalid'}},{isPasswordRecoveryFlow:true},{readPublicProfileSlugFromUrl:()=> 'public'}]) {
    const {ctx,calls} = setup({currentUser:{id:'u1',email:'test@example.invalid'},...override}); intent(ctx); await ctx.resumePendingListIntent(); assert.ok(!calls.includes('save'));
  }
});
test('cancel or account switch while loading does not save', async () => {
  const {ctx,calls} = setup({currentUser:{id:'u1',email:'test@example.invalid'}}); intent(ctx);
  ctx.fetchUserStatuses=async()=>{ctx.currentUser={id:'u2'};return true;}; await ctx.resumePendingListIntent(); assert.ok(!calls.includes('save'));
});
test('a past password reset is not a new recovery flow', async () => {
  const {ctx} = setup(); await ctx.bootstrapAuthFromUrl(); assert.equal(ctx.isPasswordRecoveryFlow,false); assert.match(ctx.pendingAuthNotice,/confirmado/);
});
for (const name of ['fetchUserAnimeBundle','fetchUserStatuses','fetchUserRatings','fetchUserProgress']) {
  test(`${name} ignores responses after switching accounts`, async () => {
    for (const fails of [false,true]) {
      const {ctx} = setup({currentUser:{id:'u1'},userAnimeBundleFeatureAvailable:true});
      ctx.safeSupabase=async()=>{ctx.currentUser={id:'u2'};if(fails)throw Error('old request');return{data:[]};};
      vm.runInContext(source.match(new RegExp(`^async function ${name}\\([^]*?^}`, 'm'))[0],ctx);
      assert.equal(await ctx[name](),false);
    }
  });
}
test('current recovery link stays in recovery mode', async () => {
  const {ctx} = setup({getAuthUrlState:()=>({code:'test',type:'recovery'})}); await ctx.bootstrapAuthFromUrl(); assert.equal(ctx.isPasswordRecoveryFlow,true); assert.equal(ctx.pendingAuthNotice,'');
});
test('metrics require consent and never accept arbitrary data/events', () => {
  const {ctx,calls} = setup(); ctx.trackProductEvent('list_saved'); assert.equal(calls.length,0);
  ctx.analyticsLoaded=true; ctx.readCookieConsent=()=> 'accepted'; ctx.trackProductEvent('email'); assert.equal(calls.length,0);
  ctx.trackProductEvent('list_saved'); assert.equal(calls[0][0],'event'); assert.equal(calls[0][1],'list_saved');
  assert.equal(calls[0][2].page_location,'https://neoanimez.com/'); assert.equal(calls[0][2].page_referrer,''); assert.ok(!JSON.stringify(calls).includes('secret'));
  for (const name of ['search_submitted','recommendation_surprise','recommendation_personal','recommendation_mood','discovery_cover_open','featured_open','signup_submitted','signup_confirmation_prompted']) {
    ctx.trackProductEvent(name);
    assert.equal(calls.at(-1)[1],name);
    assert.deepEqual(Object.keys(calls.at(-1)[2]),['page_location','page_referrer']);
  }
  const count=calls.length; ctx.readCookieConsent=()=> 'rejected'; ctx.trackProductEvent('search_submitted'); assert.equal(calls.length,count);
});
test('HTML opens discovery and has accessible save and account controls', () => {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(!html.includes('id="intro-screen"')); assert.match(html,/id="search-screen" class="screen active"/);
  assert.match(html,/id="modalAddToList"/); assert.match(html,/id="authFeedback"[^>]+role="status"/);
  for(const file of ['assets/neoanimez.css','assets/neoanimez.js']) assert.ok(html.includes(`${file}?v=20261011-discovery-flow`));
});

function signupSetup({ password='test-only-password', confirmation=password, response={data:{session:null}}, fails=false }={}) {
  const messages=[], events=[], requests=[];
  const fields={
    signupEmail:{value:' test@example.invalid '},signupPassword:{value:password},signupPasswordConfirm:{value:confirmation},
    signupForm:{reset(){events.push('form-reset');},querySelector(){return {};}}
  };
  const ctx={
    document:{getElementById:id=>fields[id]},AUTH_REDIRECT_URL:'https://neoanimez.com/',
    runLocked:async(name,fn)=>fn(),setButtonBusy:()=>{},bindListIntentToEmail:email=>requests.push({email}),
    setAuthFeedback:(text,type)=>messages.push({text,type}),trackProductEvent:name=>events.push(name),readPendingListIntent:()=>({animeId:1}),
    safeSupabase:async(name,fn)=>fn(),userFacingSupabaseError:(error,fallback)=>fallback,
    supabaseClient:{auth:{signUp:async args=>{requests.push(args);if(fails)throw Error('offline');return response;}}}
  };
  vm.createContext(ctx);vm.runInContext(source.match(/^async function handleSignup\([^]*?^}/m)[0],ctx);
  return {ctx,messages,events,requests};
}
test('email-confirmation signup explains next step, preserves intent and is not counted as confirmed',async()=>{
  const {ctx,messages,events,requests}=signupSetup();await ctx.handleSignup({preventDefault(){}});
  assert.match(messages.at(-1).text,/Revisa tu correo/);assert.match(messages.at(-1).text,/Spam/);assert.match(messages.at(-1).text,/anime/);
  assert.ok(events.includes('signup_confirmation_prompted'));assert.ok(!events.includes('sign_up'));
  assert.equal(requests[1].options.emailRedirectTo,'https://neoanimez.com/');
});
test('signup with immediate session keeps the success path',async()=>{
  const {ctx,messages,events}=signupSetup({response:{data:{session:{user:{id:'test-only'}}}}});await ctx.handleSignup({preventDefault(){}});
  assert.match(messages.at(-1).text,/sesión iniciada/);assert.ok(events.includes('sign_up'));assert.ok(!events.includes('signup_confirmation_prompted'));
});
test('invalid signup does not call auth or count a submission',async()=>{
  for (const values of [{password:'short'},{confirmation:'different'}]) {
    const {ctx,messages,events,requests}=signupSetup(values);await ctx.handleSignup({preventDefault(){}});
    assert.equal(messages.at(-1).type,'error');assert.deepEqual(requests,[]);assert.deepEqual(events,[]);
  }
});
test('failed signup leaves a retryable error, not a confirmation message',async()=>{
  const {ctx,messages,events}=signupSetup({fails:true});await ctx.handleSignup({preventDefault(){}});
  assert.equal(messages.at(-1).type,'error');assert.deepEqual(events,['signup_submitted']);
});
