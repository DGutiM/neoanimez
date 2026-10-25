const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/neoanimez.js'), 'utf8');
const functions = ['getTimestamp', 'getContinueWatchingItems', 'stabilizeDailyVisitOrder']
  .map(name => source.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');
function setup() {
  const ctx = { currentUser: { id: 'user-a' }, activeScreenName: 'user', dailyVisitOrder: null,
    userAnimeMap: new Map([1,2,3,4,5,6].map(id => [id, 'watching'])),
    userStatusUpdatedMap: new Map(), progress: new Map(), getAnimeById: id => ({ mal_id: id, title: String(id) }),
    isAnimeVisible: () => true, getProgressPercent: () => 0, getAnimeDisplayTitle: a => a.title };
  ctx.getDisplayProgress = anime => ctx.progress.get(anime.mal_id);
  vm.createContext(ctx); vm.runInContext(functions, ctx);
  ctx.ids = () => Array.from(ctx.getContinueWatchingItems(), item => item.anime.mal_id);
  return ctx;
}
test('repeated +/- changes keep all five cards in place during the visit', () => {
  const ctx = setup(); assert.deepEqual(ctx.ids(), [1,2,3,4,5]);
  for (const episode of [3,4,5,4,3]) {
    ctx.progress.set(5, { episode_number: episode, updated_at: '2026-10-25T14:00:00Z' });
    assert.deepEqual(ctx.ids(), [1,2,3,4,5]);
    assert.equal(ctx.getContinueWatchingItems()[4].episode, episode);
  }
});
test('activity in the full list does not replace the daily cards mid-visit', () => {
  const ctx = setup(); ctx.ids();
  ctx.progress.set(6, { episode_number: 2, updated_at: '2026-10-25T14:00:00Z' });
  assert.deepEqual(ctx.ids(), [1,2,3,4,5]);
  ctx.dailyVisitOrder = null; assert.deepEqual(ctx.ids(), [6,1,2,3,4]);
});
test('completed/removed cards disappear and a newly watching title can fill a vacancy', () => {
  const ctx = setup(); ctx.ids(); ctx.userAnimeMap.set(3, 'completed'); ctx.userAnimeMap.delete(2);
  ctx.userAnimeMap.set(7, 'watching'); assert.deepEqual(ctx.ids(), [1,4,5,6,7]);
});
test('account changes and navigation reset the order; background renders do not lock it', () => {
  const ctx = setup(); ctx.ids();
  ctx.progress.set(5, { episode_number: 1, updated_at: '2026-10-25T14:00:00Z' });
  ctx.currentUser = { id: 'user-b' }; assert.equal(ctx.ids()[0], 5);
  ctx.dailyVisitOrder = null; ctx.activeScreenName = 'search'; ctx.ids();
  assert.equal(ctx.dailyVisitOrder, null);
  assert.match(source, /if \(fromScreen !== targetName\) dailyVisitOrder = null/);
});
