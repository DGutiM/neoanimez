const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/neoanimez.js'), 'utf8');
const functions = ['getDiscoveryAnimeItems', 'renderDiscoveryShelf', 'openDiscoveryHome'].map(name => {
  const match = source.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, name);
  return match[0];
}).join('\n');

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; }
  replaceChildren() { this.children = []; }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.children.push(item); }
  addEventListener(name, fn) { this.events[name] = fn; }
}
function setup() {
  const shelf = new Element('ul');
  const loaded = [];
  const opened = [];
  const ctx = {
    Map, Set, DB: [52991, 1, 11061, 1535, 38000, 9253, 20].map(mal_id => ({mal_id, title:`Anime ${mal_id}`})),
    RANKING_DATA: [{mal_id:52991}, {mal_id:20}],
    isAdultAnime: anime => !!anime.adult,
    isUpcomingAnime: anime => !!anime.upcoming,
    document: {getElementById: () => shelf, createElement: tag => new Element(tag)},
    getAnimeDisplayTitle: anime => anime.title,
    loadAnimeImageElement: (image, anime) => { image.src = `cover-${anime.mal_id}.jpg`; loaded.push(anime.mal_id); },
    openAnimeModal: (...args) => opened.push(args),
    screenScrollPositions: {search:900, user:400}, showScreen: name => opened.push(name)
  };
  vm.createContext(ctx); vm.runInContext(functions, ctx);
  return {ctx,shelf,loaded,opened};
}
test('six stable, unique real catalogue entries', () => {
  const {ctx} = setup();
  assert.deepEqual(Array.from(ctx.getDiscoveryAnimeItems(), a => a.mal_id), [52991,1,11061,1535,38000,9253]);
});
test('missing, adult and unreleased entries are skipped, with catalogue fallbacks', () => {
  const {ctx} = setup(); ctx.DB[0].adult = true; ctx.DB[1].upcoming = true; ctx.DB.splice(2,1);
  const ids = Array.from(ctx.getDiscoveryAnimeItems(), a => a.mal_id);
  assert.deepEqual(ids, [1535,38000,9253,20]);
});
test('empty catalogue hides the strip and does not queue images', () => {
  const {ctx,shelf,loaded} = setup(); ctx.DB = []; ctx.renderDiscoveryShelf();
  assert.equal(shelf.hidden,true); assert.equal(shelf.attributes['aria-busy'],'false'); assert.equal(loaded.length,0);
});
test('covers use the current title language, open the correct modal and reuse the image loader', () => {
  const {ctx,shelf,loaded,opened} = setup();
  ctx.getAnimeDisplayTitle = () => '<Nombre en español>';
  ctx.renderDiscoveryShelf();
  assert.equal(shelf.children.length,6); assert.equal(loaded.length,6);
  const button = shelf.children[0].children[0];
  assert.equal(button.attributes['aria-label'],'Ver <Nombre en español>');
  assert.equal(button.children[1].textContent,'<Nombre en español>');
  button.events.click(); assert.equal(opened[0][0].mal_id,52991); assert.equal(opened[0][1],'cover-52991.jpg');
  ctx.renderDiscoveryShelf(); assert.equal(shelf.children.length,6);
});
test('the welcome shortcut returns to the top of discovery without losing list scroll', () => {
  const {ctx,opened} = setup(); ctx.openDiscoveryHome();
  assert.equal(ctx.screenScrollPositions.search,0); assert.equal(ctx.screenScrollPositions.user,400); assert.deepEqual(opened,['search']);
});
test('welcome is within the logged-in view; recommendation controls and navigation remain available', () => {
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(html.indexOf('id="listWelcome"') > html.indexOf('id="userLoggedView"'));
  assert.match(html, /id="nav-search"[^]*?Descubrir\s*<\/button>/);
  for (const id of ['tasteAnimeButton','randomAnimeButton','discoveryCovers','titleSearchInput','titleSearchButton']) assert.ok(html.includes(`id="${id}"`));
});
