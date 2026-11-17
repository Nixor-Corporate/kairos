import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const elements = {
  courseRoster: { innerHTML: '', appendChild() { throw Error('Stale roster rendered'); } },
  userSearchResults: { innerHTML: '', appendChild() { throw Error('Stale search rendered'); } },
  userSearchInput: { value: 'Fixture' },
};
const context = vm.createContext({
  window: {},
  document: {
    addEventListener() {},
    getElementById: id => elements[id] ?? null,
    createElement: () => ({}),
  },
  console,
});
vm.runInContext(fs.readFileSync('public/js/manager.js', 'utf8'), context);
const pending = vm.runInContext(`
  const deferred = [];
  apiGet = path => new Promise(resolve => deferred.push(resolve));
  activeCourseId = 111;
  const roster = loadRoster();
  const search = searchUsers();
  activeCourseId = 112;
  deferred.forEach(resolve => resolve([{ user_id: 101, name: 'Fixture Student' }]));
  Promise.all([roster, search]);
`, context);
await pending;
assert.equal(elements.courseRoster.onclick, null);
assert.equal(elements.userSearchResults.onclick, null);
console.log('Stale manager enrollment responses did not install actions in the new course.');
