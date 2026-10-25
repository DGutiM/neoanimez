const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/anime-extras.js'), 'utf8');
function setup(overrides={}) {
  const ctx = {URL,window:{location:{href:'https://neoanimez.com/?perfil=private&code=secret#access_token=secret'}},
    withCatalogVersion:p=>p, ...overrides};
  vm.createContext(ctx); vm.runInContext(source,ctx); return ctx;
}
test('share link contains only the public anime ID, never profile or authentication tokens',()=>{
  const ctx=setup(); assert.equal(ctx.getSagaShareLink(52991),'https://neoanimez.com/?saga=52991');
  assert.equal(ctx.getSagaShareLink(-1),''); assert.equal(ctx.getSagaShareLink('52991'),'');
});
test('shared links reject arbitrary strings and invalid IDs',()=>{
  const ctx=setup();assert.equal(ctx.readSharedSagaId('https://neoanimez.com/?saga=52991'),52991);
  for(const value of ['-1','0','1x','1.5','Infinity','<script>'])assert.equal(ctx.readSharedSagaId(`https://neoanimez.com/?saga=${value}`),0);
});
test('an unmarked or unknown episode is never labelled canon',()=>{
  const ctx=setup();assert.equal(ctx.episodeMark({filler:false,recap:false}).label,'Sin marca');
  assert.equal(ctx.episodeMark({}).label,'Sin datos');
  assert.equal(ctx.episodeMark({filler:true,recap:true}).label,'Relleno / resumen');
});
test('extras deduplicate downloads and reject wrong IDs or unsafe paths',async()=>{
  let calls=0;const ctx=setup({fetchCatalogJson:async()=>{calls++;return {version:1,entries:{20:{mal_id:20}}};}});
  const index={files:['anime-extras/extras-04.json'],entries:{20:{block:0}}};
  await Promise.all([ctx.loadAnimeExtraBlock(index,20),ctx.loadAnimeExtraBlock(index,20)]);
  assert.equal(calls,1);
  await assert.rejects(ctx.loadAnimeExtraBlock({...index,entries:{21:{block:0}}},21));
  await assert.rejects(ctx.loadAnimeExtraBlock({files:['https://evil.test/file.json'],entries:{20:{block:0}}},20));
});
test('failed block download remains retryable without refreshing the page',async()=>{
  let calls=0;const ctx=setup({fetchCatalogJson:async()=>{if(++calls===1)throw Error('offline');return {version:1,entries:{20:{mal_id:20}}};}});
  const index={files:['anime-extras/extras-04.json'],entries:{20:{block:0}}};
  await assert.rejects(ctx.loadAnimeExtraBlock(index,20));
  assert.equal((await ctx.loadAnimeExtraBlock(index,20)).mal_id,20);assert.equal(calls,2);
});
