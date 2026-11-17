import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function page(path, options = {}) {
  const handlers = {};
  const queueContainer = { addEventListener() {}, querySelectorAll: () => [] };
  const document = {
    getElementById: id => id === 'queuesContainer' ? queueContainer : null,
    addEventListener: (name, fn) => { handlers[name] = fn; },
    hidden: false,
  };
  const window = { location: { href: 'https://staging.example.test/signoff/room?room_id=3' } };
  const context = vm.createContext({ URL, URLSearchParams, document, window, console, ...options });
  vm.runInContext(fs.readFileSync(path, 'utf8'), context);
  return { context, handlers, run: source => vm.runInContext(source, context) };
}

const room = page('public/js/room.js');
room.run(`
  state.roomId = 3;
  state.userId = 17;
  let alerts = [];
  let snapshots = [];
  let requestCount = 0;
  showServeNotification = name => alerts.push(name);
  playServeNotificationSound = () => {};
  showEmptyMessage = () => {};
  createQueueCard = () => {};
  updateQueueCard = () => {};
  fetchQueues = async () => { requestCount++; return snapshots.shift(); };
  const waiting = {queue_id: 5, students: [{id: 17, status: 'waiting'}]};
  const serving = {queue_id: 5, serving: {ta_assignment_id: 25, student_user_id: 17, ta_user_id: 18, ta_name: 'TA One'}};
  const finished = {queue_id: 5, students: []};
  snapshots.push([waiting], [serving], [serving], [finished], [{...serving, serving: {...serving.serving, ta_assignment_id: 26}}]);
`);
await room.run('reloadQueuesFromServer()');
assert.equal(room.run('state.currentQueueIdInRoom'), 5);
await room.run('reloadQueuesFromServer()');
assert.equal(room.run('alerts.join()'), 'TA One', 'a missed serving event is recovered from REST');
assert.equal(room.run('state.currentQueueIdInRoom'), 5, 'serving is membership even without a waiting row');
await room.run('handleTaAcceptPayload({room_id: 3, payload: {student_user_id: 17}}); state.refreshPromise');
assert.equal(room.run('alerts.length'), 1, 'duplicate Socket.IO or focus hints do not play another alert');
await room.run('handleQueueBroadcast({room_id: 4, payload: {queueId: 5}}); Promise.resolve()');
assert.equal(room.run('requestCount'), 3, 'another room cannot change this snapshot');
await room.run('refreshVisibleRoom(); state.refreshPromise');
assert.equal(room.run('state.currentQueueIdInRoom'), null, 'finished service clears the room membership');
await room.run('reloadQueuesFromServer()');
assert.equal(room.run('alerts.length'), 2, 'new serving assignment alerts again');
assert.equal(room.run('formatEstimatedWait(normalizeQueue(waiting), 17)'), 'Wait estimate unavailable');
assert.equal(room.run("formatEstimatedWait(normalizeQueue({...waiting, avg_handle_minutes: 6}), 17)"), 'Estimated wait: ~6 minutes');
assert.equal(room.run('formatEstimatedWait(normalizeQueue(serving), 17)'), '');

const session = page('public/js/room.js', { fetch: async () => ({ ok: false, status: 503 }) });
await assert.rejects(session.run('ensureLoggedIn()'), error => error.status === 503);
session.context.fetch = async () => ({ ok: true, json: async () => [] });
await assert.rejects(session.run('ensureLoggedIn()'), error => error.status === 401);
session.context.fetch = async () => ({ ok: true, json: async () => ({ email: 'student@example.test' }) });
assert.equal((await session.run('ensureLoggedIn()')).email, 'student@example.test');

const ta = page('public/js/ta.js');
ta.run(`
  let requests = {};
  let rendered = [];
  apiGet = path => new Promise(resolve => { requests[path] = resolve; });
  renderQueues = () => rendered.push([...taState.queues].map(q => q.queue_id).join());
  taState.selectedCourse = '1';
  taState.selectedRoom = '10';
  const original = loadQueues('10');
  taState.selectedCourse = '2';
  taState.selectedRoom = '20';
  const newer = loadQueues('20');
  requests['./api/ta/queues.php?room_id=20']({queues: [{queue_id: 22}]});
  requests['./api/ta/queues.php?room_id=10']({queues: [{queue_id: 11}]});
`);
await ta.run('Promise.all([original, newer])');
assert.equal(ta.run('rendered.join()'), '22', 'a slow previous room must not repaint the current selection');
console.log('Serving reconciliation, session response classification and TA room race passed.');
