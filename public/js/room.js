const queuesContainer = document.getElementById('queuesContainer');
const roomTitleEl = document.getElementById('roomTitle');
const roomBadgeEl = document.getElementById('roomBadge');
const roomMetaEl = document.getElementById('roomMeta');
const roomMain = document.getElementById('roomMain');
const roomCard = document.getElementById('roomCard');
const toastStack = document.getElementById('toastStack');
let serveAudio;

const SERVED_SOUND_SRC = new URL('./sounds/served-notification.mp3', window.location.href).href;

const state = {
  roomId: null,
  userId: null,
  userName: '',
  loading: false,
  queues: new Map(),
  queueRefs: new Map(),
  me: null,
  initialized: false,
  currentQueueIdInRoom: null,
  servingAlerts: new Map(),
  refreshPromise: null,
  refreshPending: false,
};

document.addEventListener('DOMContentLoaded', async () => {
  if (state.initialized) return;
  state.initialized = true;

  const roomId = parseRoomId();
  if (!roomId) {
    showErrorCard('Missing or invalid room ID.');
    return;
  }

  state.roomId = roomId;
  document.title = `Room #${roomId}`;
  if (roomBadgeEl) roomBadgeEl.textContent = `Room #${roomId}`;
  if (roomTitleEl) roomTitleEl.textContent = `Room #${roomId}`;
  if (roomMetaEl) roomMetaEl.textContent = 'Queues currently open for this room.';

  try {
    const me = await ensureLoggedIn();
    state.me = me;
    state.userId = me?.user_id != null ? Number(me.user_id) : null;
    state.userName = me?.name || '';
  } catch (err) {
    if (err.status === 401) {
      if (window.KairosIdentity) window.KairosIdentity.handleSessionExpired();
      else window.location.replace('/');
    } else {
      showErrorCard('We could not check your session. Reload this page to try again.');
    }
    return;
  }

  if (window.SignoffWS) {
    if (state.userId != null) {
      window.SignoffWS.setSelfUserId(state.userId);
    }
    window.SignoffWS.init({
      getFilters: () => ({ roomId: state.roomId ? Number(state.roomId) : null }),
      onQueue: handleQueueBroadcast,
      onTaAccept: handleTaAcceptPayload,
    });
    window.SignoffWS.updateFilters({ roomId: Number(state.roomId) });
  }

  window.addEventListener('kairos:realtime-status', event => {
    if (event.detail?.status === 'connected') reloadQueuesFromServer();
  });
  window.addEventListener('focus', refreshVisibleRoom);
  window.addEventListener('online', refreshVisibleRoom);
  document.addEventListener('visibilitychange', refreshVisibleRoom);
  setInterval(refreshVisibleRoom, 30000);
  await loadInitialQueues();
});

async function loadInitialQueues() {
  if (!state.roomId) return;
  setLoading(true, { showSkeleton: true });
  try {
    await reloadQueuesFromServer({ reportInitialError: true });
  } catch (err) {
    console.error('queues fetch failed', err);
    if (queuesContainer) queuesContainer.innerHTML = '<div class="card">We could not load queues. Retrying when this page is active.</div>';
  } finally {
    setLoading(false);
  }
}

function parseRoomId() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('room_id');
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function ensureLoggedIn() {
  const resp = await fetch('./api/me.php', {
    credentials: 'same-origin',
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!resp.ok) {
    throw Object.assign(new Error('Unable to check session'), { status: resp.status });
  }
  const data = await resp.json();
  if (Array.isArray(data) && data.length === 0) {
    throw Object.assign(new Error('Sign-in required'), { status: 401 });
  }
  if (!data?.email) throw new Error('Invalid session response');
  return data;
}

async function fetchQueues(roomId) {
  const resp = await fetch(`./api/queues.php?room_id=${encodeURIComponent(roomId)}`, {
    credentials: 'same-origin',
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!resp.ok) {
    throw Object.assign(new Error(`queues ${resp.status}`), { status: resp.status });
  }
  return resp.json();
}

function detectCurrentQueueIdInRoom() {
  if (state.userId == null) return null;
  for (const queue of state.queues.values()) {
    const hasMembership = queue.serving?.student_user_id === state.userId
      || queue.occupants.some(student => student.user_id === state.userId);
    if (hasMembership) {
      return queue.queueId;
    }
  }
  return null;
}

function refreshCurrentQueueMembership({ forceUpdateButtons = false } = {}) {
  const detected = detectCurrentQueueIdInRoom();
  const changed = state.currentQueueIdInRoom !== detected;
  state.currentQueueIdInRoom = detected;

  if (changed || forceUpdateButtons) {
    state.queueRefs.forEach((refs, queueId) => {
      const queue = state.queues.get(queueId);
      if (queue) {
        updateQueueButtons(queue, refs);
        updateQueueNote(queue, refs);
      }
    });
  }
}

function getCurrentQueueIdInRoom() {
  if (state.currentQueueIdInRoom == null) {
    state.currentQueueIdInRoom = detectCurrentQueueIdInRoom();
  }
  return state.currentQueueIdInRoom;
}

function normalizeQueue(raw) {
  const queueId = Number(raw?.queue_id ?? raw?.queueId ?? 0);
  const roomId = Number(raw?.room_id ?? raw?.roomId ?? state.roomId ?? 0);
  const name = raw?.name || `Queue #${queueId}`;
  const description = raw?.description || '';
  const studentsRaw = Array.isArray(raw?.students) ? raw.students : [];
  const students = studentsRaw.map(normalizeQueueStudent);
  let serving = null;
  const servingRaw = raw?.serving;
  if (servingRaw && typeof servingRaw === 'object') {
    const taId = servingRaw.ta_user_id != null ? Number(servingRaw.ta_user_id) : null;
    const studentId = servingRaw.student_user_id != null ? Number(servingRaw.student_user_id) : null;
    if (taId || studentId) {
      serving = {
        ta_assignment_id: servingRaw.ta_assignment_id ?? null,
        ta_user_id: taId,
        ta_name: servingRaw.ta_name || '',
        student_user_id: studentId,
        student_name: servingRaw.student_name || '',
        started_at: servingRaw.started_at || null,
      };
    }
  }

  const occupants = students
    .filter((student) => student.status === 'waiting')
    .map((student) => ({
      user_id: student.id,
      name: student.name,
      joined_at: student.joinedAt || null,
    }));

  const occupantCount = raw?.occupant_count != null
    ? Number(raw.occupant_count)
    : occupants.length;

  const updatedAt = raw?.updated_at != null ? Number(raw.updated_at) : Math.floor(Date.now() / 1000);

  return {
    queueId,
    roomId,
    name,
    description,
    students,
    occupants,
    occupantCount,
    averageHandleMinutes: Number(raw?.avg_handle_minutes),
    serving,
    updatedAt,
  };
}

function normalizeQueueStudent(student) {
  const id = Number(student?.id ?? student?.user_id ?? 0);
  let status = student?.status || 'waiting';
  if (!['waiting', 'serving', 'done'].includes(status)) {
    status = 'waiting';
  }
  const joinedAt = student?.joinedAt ?? student?.joined_at ?? null;
  return {
    id,
    name: student?.name || '',
    status,
    joinedAt,
  };
}

function createQueueCard(queue) {
  if (!queuesContainer) return null;
  hideEmptyMessage();

  const card = document.createElement('div');
  card.className = 'queue-row';
  card.dataset.queueId = String(queue.queueId);

  const header = document.createElement('div');
  header.className = 'queue-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'queue-header-text';

  const title = document.createElement('div');
  title.className = 'q-name';
  title.textContent = queue.name || `Queue #${queue.queueId}`;
  titleWrap.appendChild(title);

  if (queue.description) {
    const desc = document.createElement('div');
    desc.className = 'q-desc';
    desc.textContent = queue.description;
    titleWrap.appendChild(desc);
  }

  const waitEstimate = document.createElement('div');
  waitEstimate.className = 'muted small';
  waitEstimate.dataset.role = 'wait-estimate';
  titleWrap.appendChild(waitEstimate);

  const actions = document.createElement('div');
  actions.className = 'queue-actions';

  const joinBtn = document.createElement('button');
  joinBtn.className = 'btn btn-ghost';
  joinBtn.type = 'button';
  joinBtn.dataset.action = 'join';
  joinBtn.dataset.queueId = String(queue.queueId);
  joinBtn.dataset.loadingText = 'Joining…';
  joinBtn.textContent = 'Join';

  const leaveBtn = document.createElement('button');
  leaveBtn.className = 'btn';
  leaveBtn.type = 'button';
  leaveBtn.dataset.action = 'leave';
  leaveBtn.dataset.queueId = String(queue.queueId);
  leaveBtn.dataset.loadingText = 'Leaving…';
  leaveBtn.textContent = 'Leave';

  actions.appendChild(joinBtn);
  actions.appendChild(leaveBtn);

  header.appendChild(titleWrap);
  header.appendChild(actions);

  const queueNote = document.createElement('div');
  queueNote.className = 'muted small';
  queueNote.dataset.role = 'queue-note';
  queueNote.setAttribute('role', 'status');
  queueNote.hidden = true;

  const occupantsWrap = document.createElement('div');
  occupantsWrap.className = 'queue-occupants';
  occupantsWrap.dataset.role = 'occupants';

  const label = document.createElement('div');
  label.className = 'occupant-label';
  label.dataset.role = 'occupant-label';
  occupantsWrap.appendChild(label);

  const pills = document.createElement('div');
  pills.className = 'occupant-pills';
  pills.dataset.role = 'occupant-pills';
  occupantsWrap.appendChild(pills);

  card.appendChild(header);
  card.appendChild(queueNote);
  card.appendChild(occupantsWrap);

  queuesContainer.appendChild(card);

  state.queueRefs.set(queue.queueId, {
    root: card,
    joinButton: joinBtn,
    leaveButton: leaveBtn,
    label,
    pills,
    occupantsWrap,
    waitEstimate,
    queueNote,
  });

  updateQueueCard(queue);
  return card;
}

function removeQueue(queueId) {
  const refs = state.queueRefs.get(queueId);
  if (refs?.root) {
    refs.root.remove();
  }
  state.queueRefs.delete(queueId);
  state.queues.delete(queueId);

  refreshCurrentQueueMembership({ forceUpdateButtons: true });

  if (state.queues.size === 0) {
    showEmptyMessage();
  }
}

function updateQueueCard(queue) {
  const refs = state.queueRefs.get(queue.queueId);
  if (!refs) return;

  updateQueueStudents(queue, refs);
  updateQueueButtons(queue, refs);
  updateQueueWaitEstimate(queue, refs);
  updateQueueNote(queue, refs);
}

function updateQueueStudents(queue, refs) {
  if (!refs.label || !refs.pills || !refs.occupantsWrap) return;

  const count = Number.isFinite(queue.occupantCount) ? queue.occupantCount : queue.occupants.length;
  if (count <= 0) {
    refs.label.textContent = 'No one in this queue yet.';
    refs.occupantsWrap.classList.add('empty');
    refs.pills.innerHTML = '<span>No one in this queue yet.</span>';
    return;
  }

  const label = count === 1 ? '1 person in queue' : `${count} people in queue`;
  refs.label.textContent = label;
  refs.occupantsWrap.classList.remove('empty');

  const fragment = document.createDocumentFragment();
  queue.occupants.forEach((occupant) => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = occupant?.name ? occupant.name : `User #${occupant?.user_id ?? ''}`;
    fragment.appendChild(pill);
  });
  refs.pills.innerHTML = '';
  refs.pills.appendChild(fragment);
}

function updateQueueButtons(queue, refs) {
  const joinBtn = refs.joinButton;
  const leaveBtn = refs.leaveButton;
  if (!joinBtn || !leaveBtn) return;

  const selfId = state.userId;
  const waitingIds = new Set(queue.occupants.map((occ) => occ.user_id));
  const isWaiting = selfId != null && waitingIds.has(selfId);
  const isServing = selfId != null && queue.serving?.student_user_id === selfId;
  const activeQueueId = getCurrentQueueIdInRoom();
  const inAnotherQueue = activeQueueId != null && activeQueueId !== queue.queueId;

  if (joinBtn.dataset.loading === '1') {
    joinBtn.disabled = true;
  } else {
    joinBtn.disabled = isWaiting || isServing || inAnotherQueue;
  }

  const leaveDisabled = !isWaiting || isServing;
  if (leaveBtn.dataset.loading === '1') {
    leaveBtn.disabled = true;
  } else {
    leaveBtn.disabled = leaveDisabled;
  }

  if (inAnotherQueue) {
    joinBtn.title = 'You are already in a queue in this room.';
  } else {
    joinBtn.removeAttribute('title');
  }
}

function updateQueueWaitEstimate(queue, refs) {
  if (!refs.waitEstimate) return;
  const label = formatEstimatedWait(queue, state.userId);
  refs.waitEstimate.textContent = label;
}

function updateQueueNote(queue, refs) {
  if (!refs.queueNote) return;
  const activeQueueId = getCurrentQueueIdInRoom();
  const isServingMe = queue.serving?.student_user_id != null && state.userId != null
    ? Number(queue.serving.student_user_id) === Number(state.userId)
    : false;

  let note = '';
  if (isServingMe) {
    const taName = queue.serving.ta_name || 'Your TA';
    note = `${taName} is serving you now. Ask your TA to end the session when you are finished.`;
  } else if (activeQueueId && activeQueueId !== queue.queueId) {
    note = 'You are already in a queue in this room. Please leave that queue before joining another.';
  }

  refs.queueNote.textContent = note;
  refs.queueNote.hidden = !note;
}

function handleQueueBroadcast(message) {
  const payload = message?.payload ?? message;
  const roomId = Number(payload?.roomId ?? payload?.room_id ?? message?.room_id);
  if (state.roomId && (!roomId || roomId === state.roomId)) reloadQueuesFromServer();
}

function refreshVisibleRoom() {
  if (!document.hidden) reloadQueuesFromServer();
}

function reloadQueuesFromServer({ reportInitialError = false } = {}) {
  if (!state.roomId || !state.userId) return Promise.resolve();
  state.refreshPending = true;
  if (state.refreshPromise) return state.refreshPromise;
  state.refreshPromise = (async () => {
    while (state.refreshPending) {
      state.refreshPending = false;
      try {
        const queues = await fetchQueues(state.roomId);
        syncQueuesWithServer(Array.isArray(queues) ? queues : []);
      } catch (err) {
        if (err.status === 401 && window.KairosIdentity) {
          state.userId = null;
          state.refreshPending = false;
          window.KairosIdentity.handleSessionExpired();
        } else if (err.status === 403) {
          syncQueuesWithServer([]);
          if (queuesContainer) queuesContainer.innerHTML = '<div class="card">You do not have access to the queues in this room.</div>';
        } else if (reportInitialError) {
          throw err;
        } else {
          console.error('Failed to refresh queues', err);
        }
      }
    }
  })().finally(() => { state.refreshPromise = null; });
  return state.refreshPromise;
}

function syncQueuesWithServer(list) {
  if (!queuesContainer) return;
  queuesContainer.querySelectorAll(':scope > .sk').forEach(card => card.remove());
  const seen = new Set();

  list.forEach((raw) => {
    const queue = normalizeQueue(raw);
    if (!queue.queueId) return;
    seen.add(queue.queueId);
    if (state.queues.has(queue.queueId)) {
      const existing = state.queues.get(queue.queueId);
      Object.assign(existing, queue);
      state.queues.set(queue.queueId, existing);
      updateQueueCard(existing);
    } else {
      state.queues.set(queue.queueId, queue);
      createQueueCard(queue);
    }
  });

  Array.from(state.queues.keys()).forEach((queueId) => {
    if (!seen.has(queueId)) {
      removeQueue(queueId);
    }
  });

  refreshCurrentQueueMembership({ forceUpdateButtons: true });
  if (!state.queues.size) showEmptyMessage();
  reconcileServingAlerts();
}

function reconcileServingAlerts() {
  const active = new Map();
  for (const queue of state.queues.values()) {
    const serving = queue.serving;
    if (!serving || serving.student_user_id !== state.userId) continue;
    const key = serving.ta_assignment_id ?? `${serving.ta_user_id}:${serving.started_at}`;
    active.set(queue.queueId, key);
    if (state.servingAlerts.get(queue.queueId) === key) continue;
    showServeNotification(serving.ta_name || 'A TA');
    playServeNotificationSound();
  }
  state.servingAlerts = active;
}

function getWaitingCount(queue) {
  if (!queue) return 0;
  const waiting = queue.students.filter((student) => student.status === 'waiting');
  const waitingCount = waiting.length;
  if (Number.isFinite(queue.occupantCount)) {
    return Math.max(waitingCount, Number(queue.occupantCount));
  }
  return waitingCount;
}

function getStudentQueuePosition(queue, studentId) {
  if (!queue || studentId == null) return null;
  const waiting = queue.students.filter((student) => student.status === 'waiting');
  const index = waiting.findIndex((student) => student.id === studentId);
  return index >= 0 ? index + 1 : null;
}

function getEstimatedWaitMinutes(queue, studentId) {
  if (!queue || !Number.isFinite(queue.averageHandleMinutes) || queue.averageHandleMinutes <= 0) return null;
  const waitingCount = getWaitingCount(queue);
  const position = getStudentQueuePosition(queue, studentId);
  if (position != null) {
    return position * queue.averageHandleMinutes;
  }
  if (waitingCount <= 0 && !queue.serving) {
    return 0;
  }
  return (waitingCount + 1) * queue.averageHandleMinutes;
}

function formatEstimatedWait(queue, studentId) {
  if (queue?.serving?.student_user_id === studentId) return '';
  const minutes = getEstimatedWaitMinutes(queue, studentId);
  if (minutes == null) return 'Wait estimate unavailable';
  if (minutes <= 0) return '';
  const rounded = Math.max(1, Math.round(minutes));
  return `Estimated wait: ~${rounded} minute${rounded === 1 ? '' : 's'}`;
}

queuesContainer?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.getAttribute('data-action');
  const queueId = Number(button.getAttribute('data-queue-id'));
  if (!queueId) {
    showToast('Invalid queue.');
    return;
  }

  const queue = state.queues.get(queueId);
  if (!queue) {
    showToast('Queue unavailable.');
    return;
  }

  refreshCurrentQueueMembership();
  const activeQueueId = state.currentQueueIdInRoom;
  if (action === 'join' && activeQueueId && activeQueueId !== queueId) {
    showToast('You are already in a queue in this room. Please leave that queue before joining another.');
    return;
  }

  try {
    const loadingText = button.getAttribute('data-loading-text') || (action === 'join' ? 'Joining…' : 'Leaving…');
    startButtonLoading(button, loadingText);
    await mutateQueue(action, queueId);
    await reloadQueuesFromServer();
  } catch (err) {
    showToast(err?.message || 'Something went wrong.');
    await reloadQueuesFromServer();
  } finally {
    stopButtonLoading(button);
    const current = state.queues.get(queueId);
    if (current) updateQueueCard(current);
  }
});

async function mutateQueue(action, queueId) {
  if (action !== 'join' && action !== 'leave') {
    throw new Error('Unknown action.');
  }
  const resp = await fetch('./api/queues.php', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, queue_id: queueId }),
  });
  const contentType = resp.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await resp.json().catch(() => ({})) : {};
  if (!resp.ok || data?.success !== true) {
    const message = data?.message || data?.error;
    const error = new Error(message || 'Request failed');
    error.status = resp.status;
    throw error;
  }
  return data;
}

function startButtonLoading(button, label) {
  if (!button) return;
  if (!button.dataset.originalContent) {
    button.dataset.originalContent = button.innerHTML;
  }
  button.dataset.loading = '1';
  const text = label || 'Working…';
  button.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span class="btn-label">${escapeHtml(text)}</span>`;
  button.disabled = true;
}

function stopButtonLoading(button, { keepDisabled = false } = {}) {
  if (!button) return;
  if (button.dataset.originalContent) {
    button.innerHTML = button.dataset.originalContent;
    delete button.dataset.originalContent;
  }
  if (!keepDisabled) {
    button.disabled = false;
  }
  delete button.dataset.loading;
}

function setLoading(isLoading, { showSkeleton = false } = {}) {
  state.loading = isLoading;
  if (!roomCard || !queuesContainer) return;
  if (isLoading) {
    roomCard.classList.add('loading');
    if (showSkeleton) {
      queuesContainer.innerHTML = skeletonCards(3);
    }
  } else {
    roomCard.classList.remove('loading');
  }
}

function skeletonCards(n = 2) {
  return Array.from({ length: n }).map(() => '<div class="sk"></div>').join('');
}

function showEmptyMessage() {
  if (!queuesContainer) return;
  queuesContainer.innerHTML = `<div class="card"><strong>No open queues.</strong><div class="muted small">There are no queues for this room right now.</div></div>`;
}

function hideEmptyMessage() {
  if (!queuesContainer) return;
  const empty = queuesContainer.querySelector('.card');
  if (empty && !empty.dataset.queueId) {
    empty.remove();
  }
}

function showErrorCard(message) {
  if (!roomMain) return;
  roomMain.innerHTML = `
    <section class="card error-card">
      <h2>Room unavailable</h2>
      <p class="muted">${escapeHtml(message)}</p>
      <p><a class="btn btn-primary" href="/">Return to dashboard</a></p>
    </section>
  `;
}

function handleTaAcceptPayload(message) {
  const payload = message?.payload ?? message;
  const studentId = Number(payload?.student_user_id ?? payload?.user_id);
  const roomId = Number(payload?.room_id ?? payload?.roomId ?? message?.room_id);
  if (studentId === state.userId && (!roomId || roomId === state.roomId)) reloadQueuesFromServer();
}

function playServeNotificationSound() {
  if (typeof Audio === 'undefined') return;
  try {
    if (!serveAudio) {
      serveAudio = new Audio(SERVED_SOUND_SRC);
      serveAudio.preload = 'auto';
    }
    serveAudio.currentTime = 0;
    const playPromise = serveAudio.play();
    if (playPromise?.catch) {
      playPromise.catch((err) => { console.debug('serve notification sound blocked', err); });
    }
  } catch (err) {
    console.debug('serve notification sound failed', err);
  }
}

function showServeNotification(taName) {
  const container = toastStack || document.body;
  const toast = document.createElement('div');
  toast.className = 'toast';

  const message = document.createElement('div');
  message.innerHTML = `<strong>${escapeHtml(taName)}</strong> is serving you now, please raise your hand.`;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.textContent = '×';
  closeBtn.style.marginLeft = '12px';
  closeBtn.style.background = 'transparent';
  closeBtn.style.border = 'none';
  closeBtn.style.color = 'inherit';
  closeBtn.style.fontSize = '16px';
  closeBtn.style.cursor = 'pointer';
  closeBtn.addEventListener('click', () => toast.remove());

  toast.appendChild(message);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  requestAnimationFrame(() => { toast.classList.add('show'); });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 10000);
}

function showToast(message) {
  if (!toastStack) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-error';
  toast.textContent = message;
  toastStack.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
