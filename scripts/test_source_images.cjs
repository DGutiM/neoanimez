const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/neoanimez.js'), 'utf8');
const names = ['normalizeAnimeImageUrl', 'getOriginalAnimeImageUrl', 'uniqueImageUrls',
  'getAnimeImageCandidates', 'getImgById', 'isUpcomingAnime', 'formatUpcomingDate'];
const functions = names.map(name => source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');
function setup(fetch) {
  const context = {fetch, AbortController, imgCache:{}, imgRequests:{}, imgMetadataFailureUntil:{},
    window:{setTimeout:(fn)=>setTimeout(fn,15),clearTimeout}, Intl, Date};
  vm.createContext(context); vm.runInContext(functions,context); return context;
}
const response = (data, status=200) => ({ok:status===200,status,json:async()=>({data})});

test('stored covers are preferred and old covers are never discarded',()=>{
  const ctx=setup();
  assert.deepEqual(Array.from(ctx.getAnimeImageCandidates({image:'https://s4.anilist.co/a.jpg',image_candidates:['https://myanimelist.net/images/a.jpg']})),
    ['https://s4.anilist.co/a.jpg','https://cdn.myanimelist.net/images/a.jpg']);
});
test('image recovery normalizes both providers and validates the exact MAL ID',async()=>{
  const calls=[];
  const ctx=setup(async url=>{calls.push(url);return calls.length===1?response({mal_id:99,images:{jpg:{image_url:'https://wrong.test'}}}):response({malId:1,images:{large:'https://correct.test/a.jpg'}});});
  assert.equal(await ctx.getImgById(1),'https://correct.test/a.jpg');
  assert.ok(calls[1].startsWith('https://jikan.lucashdo.com/v1/anime/1/'));
  assert.equal(await ctx.getImgById(1),'https://correct.test/a.jpg');
  assert.equal(calls.length,2);
});
test('an API timeout settles and does not lock image loading or repeat immediately',async()=>{
  let requests=0;
  const ctx=setup((url,{signal})=>{requests++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('timeout'))));});
  assert.equal(await ctx.getImgById(1),'');
  assert.equal(await ctx.getImgById(1),'');
  assert.equal(requests,2);
  assert.deepEqual(Object.keys(ctx.imgRequests),[]);
});
test('permission and rate responses do not switch to a different provider',async()=>{
  for(const status of [401,403,429]) {
    let calls=0;const ctx=setup(async()=>{calls++;return response(null,status);});
    assert.equal(await ctx.getImgById(1),'');assert.equal(calls,1);
  }
});
test('invalid or missing IDs do not trigger remote title guessing',async()=>{
  const ctx=setup(()=>{throw new Error('unexpected network');});
  for(const id of [null,0,-1,'invalid'])assert.equal(await ctx.getImgById(id),'');
  assert.ok(!source.includes('api.jikan.moe'));
  assert.ok(!source.includes('anime?q='));
});
test('partial dates do not invent a day or release a still-announced title',()=>{
  const ctx=setup();
  assert.equal(ctx.formatUpcomingDate({aired_from:'2027'}),'2027');
  assert.match(ctx.formatUpcomingDate({aired_from:'2027-03'}),/^marzo/);
  assert.equal(ctx.isUpcomingAnime({aired_from:'2020-03',airing_status:'Not yet aired'}),true);
});
