const taState = {
  me: null,
  courses: [],
  rooms: [],
  queues: [],
  statusOptions: [],
  selectedCourse: '',
  selectedRoom: '',
  selectedStudent: null,
  studentDirectory: {},
  queueRefs: new Map(),
};

const toastStack = document.getElementById('taToastStack');

function reloadRooms() {
  if (taState.selectedCourse) {
    loadRooms(taState.selectedCourse);
  }
}

function reloadQueues() {
  if (taState.selectedRoom) {
    loadQueues(taState.selectedRoom);
  }
}

function reloadProgress() {
  if (taState.selectedStudent) {
    loadStudentProgress(taState.selectedStudent);
  }
}

const TA_SECTIONS = {
  auth: 'taAuthRequired',
  unavailable: 'taUnavailable',
  forbidden: 'taForbidden',
  dashboard: 'taDashboard',
};

document.addEventListener('DOMContentLoaded', () => {
  bootstrapTA();
  window.addEventListener('kairos:realtime-status', event => {
    if (event.detail?.status === 'connected') reloadQueues();
  });
  window.addEventListener('focus', reloadQueues);
  window.addEventListener('online', reloadQueues);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reloadQueues();
  });
  const logout = document.getElementById('kLogoutBtn') || document.getElementById('taLogoutBtn');
  if (logout) {
    logout.addEventListener('click', async () => {
      try { await fetch('./api/logout.php', { method: 'POST', credentials: 'same-origin' }); }
      finally { window.location.href = '/signoff/'; }
    });
  }
  const courseSelect = document.getElementById('taCourseSelect');
  if (courseSelect) {
    courseSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      taState.selectedCourse = val || '';
      taState.selectedRoom = '';
      taState.queueRefresh = null;
      taState.queues = [];
      taState.selectedStudent = null;
      renderRooms([]);
      renderQueues();
      clearStudentPanel();
      updateProjectorButton();
      if (window.SignoffWS) {
        window.SignoffWS.updateFilters({
          courseId: val ? Number(val) : null,
          roomId: null,
        });
      }
      if (val) {
        loadRooms(val);
      } else {
        const roomSelect = document.getElementById('taRoomSelect');
        if (roomSelect) roomSelect.disabled = true;
      }
    });
  }
  const roomSelect = document.getElementById('taRoomSelect');
  if (roomSelect) {
    roomSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      taState.selectedRoom = val || '';
      taState.queueRefresh = null;
      taState.queues = [];
      taState.selectedStudent = null;
      renderQueues();
      clearStudentPanel();
      updateProjectorButton();
      if (window.SignoffWS) {
        window.SignoffWS.updateFilters({ roomId: val ? Number(val) : null });
      }
      if (val) {
        loadQueues(val);
      }
    });
  }
  const projectorBtn = document.getElementById('taProjectorBtn');
  if (projectorBtn) {
    projectorBtn.addEventListener('click', () => {
      if (projectorBtn.disabled) return;
      openProjectorView();
    });
  }
  const progressArea = document.getElementById('taProgressArea');
  if (progressArea) {
    progressArea.addEventListener('change', async (e) => {
      const select = e.target.closest('select[data-detail]');
      if (!select) return;
      const detailId = parseInt(select.dataset.detail, 10);
      if (!detailId || !taState.selectedStudent) return;
      const status = select.value.toLowerCase();
      const previous = select.dataset.savedStatus;
      if (select.value === previous) return;
      const courseId = taState.selectedCourse;
      const studentId = taState.selectedStudent;
      const policy = taState.signoffPolicy;
      select.disabled = true;
      select.value = previous;
      try {
        if (status === 'completed' && (policy?.rating_required || policy?.comment_required)) {
          await confirmSignoff(select, detailId, studentId, status, previous, policy);
        } else {
          await saveProgress(select, detailId, studentId, status, previous, {
            policy_revision: policy?.revision,
          });
        }
      } catch (err) {
        if (taState.selectedStudent === studentId && taState.selectedCourse === courseId) {
          showToast(err.body?.message || 'Could not update progress. Try again.');
          if (err.status === 409) await loadStudentProgress(studentId);
        }
      } finally {
        select.disabled = false;
        if (select.isConnected && document.activeElement === document.body) select.focus();
      }
    });
  }
  const commentForm = document.getElementById('taCommentForm');
  if (commentForm) {
    commentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!taState.selectedStudent || !taState.selectedCourse) return;
      const textarea = document.getElementById('taCommentText');
      const text = textarea ? textarea.value.trim() : '';
      if (!text) return;
      try {
        const res = await apiPost('./api/ta/comment.php', {
          user_id: parseInt(taState.selectedStudent, 10),
          course_id: parseInt(taState.selectedCourse, 10),
          text,
        });
        if (res?.comment) {
          prependComment(res.comment);
          if (textarea) textarea.value = '';
        }
      } catch (err) {
        console.error('comment failed', err);
        alert('Failed to add comment.');
      }
    });
  }
  const queueList = document.getElementById('taQueueList');
  if (queueList) {
    queueList.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (!actionBtn) return;
      const queueId = parseInt(actionBtn.dataset.queueId || '0', 10);
      const userId = parseInt(actionBtn.dataset.userId || '0', 10);
      const action = actionBtn.dataset.action;
      if (!queueId) return;
      if (action === 'accept' && userId) {
        handleAccept(queueId, userId, actionBtn);
      }
      if (action === 'view' && userId) {
        taState.selectedStudent = userId;
        highlightSelectedStudent();
        loadStudentProgress(userId);
      }
      if (action === 'stop-serving') {
        handleStopServing(queueId, actionBtn);
      }
      if (action === 'call-again') {
        handleCallAgain(queueId, actionBtn);
      }
    });
  }
});

async function bootstrapTA() {
  try {
    let me = null;
    let caps = null;
    if (window.KairosIdentity) {
      const session = await window.KairosIdentity.fetchSession();
      if (session) {
        me = session.me;
        caps = session.caps;
      }
    }
    if (!me) {
      me = await apiGet('./api/me.php');
    }
    if (!me?.email) {
      setTaView(Array.isArray(me) && me.length === 0 ? 'auth' : 'unavailable');
      return;
    }
    taState.me = me;
    updateUserbar(me);

    if (!caps) {
      try {
        const rawCaps = await apiGet('./api/session_capabilities.php');
        caps = window.normalizeSessionRoles(rawCaps);
      } catch (err) {
        console.warn('Failed to load session capabilities in TA', err);
        caps = {};
      }
    }
    if (caps && typeof window.updateSidebarRoleLinks === 'function') {
      window.updateSidebarRoleLinks(caps);
    }
    if (window.KairosIdentity) {
      window.KairosIdentity.me = me;
      window.KairosIdentity.caps = caps;
      window.KairosIdentity.loading = false;
      window.KairosIdentity.error = false;
      window.KairosIdentity.render();
    }

    if (window.SignoffWS) {
      if (me.user_id != null) {
        window.SignoffWS.setSelfUserId(Number(me.user_id));
      }
      window.SignoffWS.init({
        getFilters: () => ({
          courseId: taState.selectedCourse ? Number(taState.selectedCourse) : null,
          roomId: taState.selectedRoom ? Number(taState.selectedRoom) : null,
        }),
        onQueue: handleQueueBroadcast,
        onRooms: () => reloadRooms(),
        onProgress: () => reloadProgress(),
      });
    }
  } catch (err) {
    console.error('me.php failed', err);
    setTaView(err.status === 401 ? 'auth' : 'unavailable');
    return;
  }

  let courses = [];
  try {
    courses = await apiGet('./api/ta/courses.php');
  } catch (err) {
    if (err.status === 403) {
      setTaView('forbidden');
      return;
    }
    if (err.status === 401) {
      setTaView('auth');
      return;
    }
    console.error('courses failed', err);
    setTaView('unavailable');
    return;
  }
  if (!Array.isArray(courses)) courses = [];
  taState.courses = courses;
  renderCourses(courses);
  setTaView('dashboard');
  updateProjectorButton();
  if (courses.length === 1) {
    taState.selectedCourse = `${courses[0].course_id}`;
    const select = document.getElementById('taCourseSelect');
    if (select) {
      select.value = taState.selectedCourse;
      select.dispatchEvent(new Event('change'));
    }
  }
  if (!courses.length) {
    const queueList = document.getElementById('taQueueList');
    if (queueList) {
      queueList.innerHTML = '<div class="card">No TA courses assigned yet.</div>';
    }
  }
}

function setTaView(view) {
  Object.entries(TA_SECTIONS).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', key !== view);
  });
  const userbar = document.getElementById('taUserbar');
  if (userbar) {
    userbar.classList.toggle('hidden', view !== 'dashboard');
  }
}

function updateUserbar(me) {
  const avatar = document.getElementById('kSidebarAvatar') || document.getElementById('taAvatar');
  const name = document.getElementById('kSidebarName') || document.getElementById('taName');
  const email = document.getElementById('kSidebarRole') || document.getElementById('taEmail');
  if (avatar) {
    const initials = window.KairosIdentity ? window.KairosIdentity.getInitials(me.name, me.email) : '?';
    avatar.src = me.picture_url || (window.KairosIdentity ? window.KairosIdentity.getAvatarSvg(initials) : '');
    avatar.onerror = () => {
      if (window.KairosIdentity) avatar.src = window.KairosIdentity.getAvatarSvg(initials);
      avatar.onerror = null;
    };
  }
  if (name) name.textContent = me.name || me.email || '';
  if (email) {
    let roleLabel = 'TA';
    if (window.KairosIdentity && window.KairosIdentity.caps) {
      const r = window.KairosIdentity.caps;
      if (r.admin) roleLabel = 'Admin';
      else if (r.manager) roleLabel = 'Manager';
      else if (r.ta) roleLabel = 'TA';
      else roleLabel = 'Student';
    }
    email.textContent = roleLabel;
  }
}

function renderCourses(courses) {
  const select = document.getElementById('taCourseSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Select a course…</option>';
  courses.forEach((course) => {
    const opt = document.createElement('option');
    opt.value = course.course_id;
    opt.textContent = `#${course.course_id} · ${course.name}`;
    select.appendChild(opt);
  });
  select.disabled = !courses.length;
}

async function loadRooms(courseId) {
  const request = Symbol();
  taState.roomsRequest = request;
  try {
    const rooms = await apiGet(`./api/ta/rooms.php?course_id=${encodeURIComponent(courseId)}`);
    if (taState.selectedCourse !== courseId || taState.roomsRequest !== request) return;
    taState.rooms = Array.isArray(rooms) ? rooms : [];
    renderRooms(taState.rooms);
  } catch (err) {
    if (taState.selectedCourse !== courseId || taState.roomsRequest !== request) return;
    showToast('Could not refresh rooms for this course. Try selecting the course again.', { tone: 'error' });
  }
}

function renderRooms(rooms) {
  const select = document.getElementById('taRoomSelect');
  if (!select) return;
  const previousRoom = taState.selectedRoom;
  select.innerHTML = '<option value="">Select a room…</option>';
  rooms.forEach((room) => {
    const opt = document.createElement('option');
    opt.value = room.room_id;
    opt.textContent = room.name ? `${room.name} (#${room.room_id})` : `Room #${room.room_id}`;
    select.appendChild(opt);
  });
  select.disabled = !rooms.length;

  const hasPreviousSelection = previousRoom
    && rooms.some((room) => `${room.room_id}` === `${previousRoom}`);

  if (hasPreviousSelection) {
    select.value = previousRoom;
  } else if (rooms.length === 1 && !previousRoom) {
    const onlyRoomId = `${rooms[0].room_id}`;
    taState.selectedRoom = onlyRoomId;
    select.value = onlyRoomId;
    select.dispatchEvent(new Event('change'));
    return;
  } else if (previousRoom) {
    select.dispatchEvent(new Event('change'));
    return;
  }

  updateProjectorButton();
}

function updateProjectorButton() {
  const btn = document.getElementById('taProjectorBtn');
  if (!btn) return;
  const enabled = !!taState.selectedRoom;
  btn.disabled = !enabled;
  btn.title = enabled ? 'Open Projector View' : 'Select a room to open Projector View';
}

function openProjectorView() {
  if (!taState.selectedRoom) return;
  const url = new URL('./projector.html', window.location.href);
  url.searchParams.set('room_id', taState.selectedRoom);
  if (taState.selectedCourse) {
    url.searchParams.set('course_id', taState.selectedCourse);
  }
  window.open(url.toString(), '_blank', 'noopener');
}

function loadQueues(roomId) {
  const courseId = taState.selectedCourse;
  const isCurrent = () => taState.selectedRoom === roomId && taState.selectedCourse === courseId;
  if (!isCurrent()) return Promise.resolve();
  const current = taState.queueRefresh;
  if (current?.courseId === courseId && current.roomId === roomId) {
    current.pending = true;
    return current.promise;
  }

  const request = { courseId, roomId, pending: true };
  taState.queueRefresh = request;
  request.promise = (async () => {
    while (request.pending && isCurrent() && taState.queueRefresh === request) {
      request.pending = false;
      try {
        const data = await apiGet(`./api/ta/queues.php?room_id=${encodeURIComponent(roomId)}`);
        if (!isCurrent() || taState.queueRefresh !== request) return;
        taState.queues = Array.isArray(data?.queues) ? data.queues.map(normalizeTaQueue) : [];
        renderQueues();
      } catch (err) {
        if (!isCurrent() || taState.queueRefresh !== request) return;
        if (err.status === 401 && window.KairosIdentity) {
          window.KairosIdentity.handleSessionExpired();
        } else if (err.status === 403 || err.status === 404) {
          taState.queues = [];
          clearStudentPanel();
          renderQueues();
        }
        showToast('Could not refresh queues for this room.', { tone: 'error' });
      }
    }
  })().finally(() => {
    if (taState.queueRefresh === request) taState.queueRefresh = null;
  });
  return request.promise;
}

function renderQueues() {
  const list = document.getElementById('taQueueList');
  const notice = document.getElementById('taServingNotice');
  if (!list) return;
  updateProjectorButton();
  list.innerHTML = '';
  taState.queueRefs = new Map();
  taState.studentDirectory = {};
  if (notice) {
    notice.textContent = '';
    notice.classList.add('hidden');
  }

  if (!taState.selectedRoom) {
    list.innerHTML = '<div class="card">Select a room to view queues.</div>';
    return;
  }
  if (!Array.isArray(taState.queues) || !taState.queues.length) {
    list.innerHTML = '<div class="card">No active queues in this room.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  taState.queues.forEach((queue) => {
    const card = createTaQueueCard(queue);
    if (card) fragment.appendChild(card);
  });
  list.appendChild(fragment);
  updateServingNotice();
}

function normalizeTaQueue(raw) {
  const queueId = Number(raw?.queue_id ?? 0);
  const name = raw?.name || `Queue #${queueId}`;
  const description = raw?.description || '';
  const studentsRaw = Array.isArray(raw?.students) ? raw.students : [];
  const students = studentsRaw.map(normalizeQueueStudentEntry);
  let occupants = Array.isArray(raw?.occupants)
    ? raw.occupants.map((occ) => ({
        user_id: occ?.user_id != null ? Number(occ.user_id) : null,
        name: occ?.name || '',
        joined_at: occ?.joined_at || null,
      })).filter((occ) => occ.user_id != null)
    : [];
  if (!occupants.length) {
    occupants = students
      .filter((student) => student.status === 'waiting')
      .map((student) => ({
        user_id: student.id,
        name: student.name,
        joined_at: student.joinedAt || null,
      }));
  }
  const occupantCount = raw?.occupant_count != null
    ? Number(raw.occupant_count)
    : occupants.length;

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

  const updatedAt = raw?.updated_at != null ? Number(raw.updated_at) : Math.floor(Date.now() / 1000);

  return {
    queue_id: queueId,
    room_id: raw?.room_id != null ? Number(raw.room_id) : null,
    name,
    description,
    occupant_count: occupantCount,
    occupants,
    students,
    serving,
    updated_at: updatedAt,
  };
}

function normalizeQueueStudentEntry(student) {
  const id = Number(student?.id ?? student?.user_id ?? 0);
  let status = student?.status || 'waiting';
  if (!['waiting', 'serving', 'done'].includes(status)) {
    status = 'waiting';
  }
  const joinedAt = student?.joined_at ?? student?.joinedAt ?? null;
  return {
    id,
    name: student?.name || '',
    status,
    joinedAt,
  };
}

function createTaQueueCard(queue) {
  const card = document.createElement('div');
  card.className = 'ta-queue-card';
  card.dataset.queueId = queue.queue_id;

  const header = document.createElement('div');
  header.className = 'ta-queue-header';

  const titleWrap = document.createElement('div');
  const title = document.createElement('h3');
  title.className = 'ta-queue-title';
  title.textContent = queue.name || `Queue #${queue.queue_id}`;
  titleWrap.appendChild(title);
  if (queue.description) {
    const desc = document.createElement('div');
    desc.className = 'ta-queue-desc';
    desc.textContent = queue.description;
    titleWrap.appendChild(desc);
  }
  header.appendChild(titleWrap);

  const statusWrap = document.createElement('div');
  statusWrap.className = 'ta-queue-status';
  const servingEl = document.createElement('div');
  servingEl.className = 'ta-queue-serving';
  statusWrap.appendChild(servingEl);
  const stopSlot = document.createElement('div');
  stopSlot.dataset.role = 'stop-slot';
  statusWrap.appendChild(stopSlot);
  header.appendChild(statusWrap);

  card.appendChild(header);

  const list = document.createElement('ul');
  list.className = 'ta-student-list';
  card.appendChild(list);

  const empty = document.createElement('div');
  empty.className = 'ta-queue-empty hidden';
  empty.textContent = 'No students waiting.';
  card.appendChild(empty);

  taState.queueRefs.set(queue.queue_id, {
    root: card,
    list,
    empty,
    serving: servingEl,
    stopSlot,
  });

  updateTaQueueCard(queue);
  return card;
}

function updateTaQueueCard(queue) {
  updateTaQueueStudents(queue);
  updateTaServingStatus(queue);
  highlightSelectedStudent();
}

function updateTaQueueStudents(queue) {
  const refs = taState.queueRefs.get(queue.queue_id);
  if (!refs || !refs.list || !refs.empty) return;

  const list = refs.list;
  const empty = refs.empty;
  const waiting = Array.isArray(queue.occupants) ? queue.occupants.filter((occ) => occ && occ.user_id != null) : [];

  waiting.forEach((occ) => {
    if (occ?.user_id != null) {
      taState.studentDirectory[occ.user_id] = occ.name || '';
    }
  });

  if (!waiting.length) {
    list.innerHTML = '';
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.classList.remove('hidden');

  const existing = new Map();
  Array.from(list.children).forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const userId = Number(node.dataset.userId);
    if (userId) {
      existing.set(userId, node);
    }
  });

  const newOrder = [];
  waiting.forEach((occ) => {
    const userId = Number(occ.user_id);
    if (!userId) return;
    let item = existing.get(userId);
    if (item) {
      existing.delete(userId);
      updateTaStudentItem(item, queue, occ);
    } else {
      item = createTaStudentItem(queue, occ);
    }
    newOrder.push(item);
  });

  existing.forEach((node) => node.remove());

  newOrder.forEach((node, index) => {
    const current = list.children[index];
    if (current !== node) {
      list.insertBefore(node, current ?? null);
    }
  });
}

function createTaStudentItem(queue, occ) {
  const li = document.createElement('li');
  li.className = 'ta-student-item';
  li.dataset.queueId = queue.queue_id;
  li.dataset.userId = occ.user_id;

  const info = document.createElement('div');
  info.className = 'ta-student-info';
  const name = document.createElement('div');
  name.className = 'ta-student-name';
  info.appendChild(name);
  const meta = document.createElement('div');
  meta.className = 'ta-student-meta';
  info.appendChild(meta);
  li.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'ta-student-actions';
  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn btn-ghost';
  viewBtn.type = 'button';
  viewBtn.dataset.action = 'view';
  viewBtn.dataset.queueId = queue.queue_id;
  viewBtn.dataset.userId = occ.user_id;
  viewBtn.textContent = 'View';
  actions.appendChild(viewBtn);

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'btn btn-primary';
  acceptBtn.type = 'button';
  acceptBtn.dataset.action = 'accept';
  acceptBtn.dataset.queueId = queue.queue_id;
  acceptBtn.dataset.userId = occ.user_id;
  acceptBtn.textContent = 'Accept';
  actions.appendChild(acceptBtn);

  li.appendChild(actions);
  updateTaStudentItem(li, queue, occ);
  return li;
}

function updateTaStudentItem(li, queue, occ) {
  const userId = Number(occ?.user_id ?? 0);
  const nameEl = li.querySelector('.ta-student-name');
  const metaEl = li.querySelector('.ta-student-meta');
  const acceptBtn = li.querySelector('button[data-action="accept"]');

  if (nameEl) {
    nameEl.textContent = occ?.name || `Student #${userId || ''}`;
  }
  if (metaEl) {
    const since = occ?.joined_at ? formatTime(occ.joined_at) : 'Waiting';
    metaEl.textContent = since ? `Waiting since ${since}` : 'Waiting';
  }

  if (taState.selectedStudent === userId) {
    li.classList.add('active');
  } else {
    li.classList.remove('active');
  }

  if (acceptBtn) {
    const serving = queue.serving;
    if (acceptBtn.dataset.loading === '1') {
      acceptBtn.disabled = true;
    } else if (serving && serving.student_user_id && serving.student_user_id !== userId) {
      acceptBtn.disabled = true;
      acceptBtn.textContent = 'In use';
    } else if (serving && serving.student_user_id === userId) {
      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Serving';
    } else {
      acceptBtn.disabled = false;
      acceptBtn.textContent = 'Accept';
    }
  }
}

function updateTaServingStatus(queue) {
  const refs = taState.queueRefs.get(queue.queue_id);
  if (!refs) return;
  const servingEl = refs.serving;
  const stopSlot = refs.stopSlot;

  if (servingEl) {
    if (queue.serving && queue.serving.student_name) {
      const taName = queue.serving.ta_name || 'TA';
      servingEl.textContent = `Serving ${queue.serving.student_name} (${taName})`;
    } else if (queue.serving && queue.serving.student_user_id) {
      servingEl.textContent = 'Serving a student';
    } else {
      servingEl.textContent = '';
    }
  }

  if (stopSlot) {
    stopSlot.innerHTML = '';
    if (queue.serving && queue.serving.ta_user_id && taState.me && queue.serving.ta_user_id === Number(taState.me.user_id)) {
      const actions = document.createElement('div');
      actions.className = 'ta-serving-actions';
      const callBtn = document.createElement('button');
      callBtn.type = 'button';
      callBtn.className = 'btn btn-secondary btn-sm';
      callBtn.dataset.action = 'call-again';
      callBtn.dataset.queueId = queue.queue_id;
      callBtn.textContent = 'Call Again';
      actions.appendChild(callBtn);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-danger btn-sm';
      btn.dataset.action = 'stop-serving';
      btn.dataset.queueId = queue.queue_id;
      btn.textContent = 'Stop Serving';
      actions.appendChild(btn);
      stopSlot.appendChild(actions);
    }
  }

  updateServingNotice();
}

function updateServingNotice() {
  const notice = document.getElementById('taServingNotice');
  if (!notice) return;
  let message = '';
  const selfId = taState.me?.user_id != null ? Number(taState.me.user_id) : null;
  if (selfId != null) {
    for (const queue of taState.queues) {
      if (queue?.serving && queue.serving.ta_user_id === selfId) {
        const queueName = queue.name || `Queue #${queue.queue_id}`;
        const studentName = queue.serving.student_name || 'a student';
        message = `Serving ${studentName} in ${queueName}`;
        break;
      }
    }
  }
  notice.textContent = message;
  notice.classList.toggle('hidden', message === '');
}

function handleQueueBroadcast(message) {
  const payload = message?.payload ?? message;
  const roomId = Number(payload?.roomId ?? payload?.room_id ?? message?.room_id);
  if (!roomId || roomId === Number(taState.selectedRoom)) reloadQueues();
}

async function handleAccept(queueId, userId, button) {
  const { selectedCourse: courseId, selectedRoom: roomId } = taState;
  if (!courseId || !roomId) return;
  const isCurrent = () => taState.selectedCourse === courseId && taState.selectedRoom === roomId;
  startButtonLoading(button, 'Accepting…');
  try {
    await apiPost('./api/ta/accept.php', { queue_id: queueId, user_id: userId });
    if (!isCurrent()) return;
    clearStudentPanel();
    taState.selectedStudent = userId;
    await loadQueues(roomId);
    if (isCurrent() && taState.selectedStudent === userId) await loadStudentProgress(userId);
  } catch (err) {
    if (!isCurrent()) return;
    showToast(err.body?.message || err.body?.error || 'Failed to accept student.', { tone: 'error' });
    await loadQueues(roomId);
  } finally {
    stopButtonLoading(button);
  }
}

async function handleStopServing(queueId, button) {
  const queue = taState.queues.find(q => q.queue_id === queueId);
  if (!queue?.serving) return;
  const { selectedRoom: roomId, selectedCourse: courseId } = taState;
  const isCurrent = () => taState.selectedRoom === roomId && taState.selectedCourse === courseId;
  startButtonLoading(button, 'Stopping…');
  try {
    const response = await apiPost('./api/ta/stop.php', {
      queue_id: queueId,
      assignment_id: queue.serving.ta_assignment_id ?? undefined,
    });
    if (!response?.success) throw new Error('Failed to stop serving.');
    if (isCurrent()) showToast('Serving session ended.');
  } catch (err) {
    if (isCurrent()) showToast(err.body?.message || 'Failed to stop serving.', { tone: 'error' });
  } finally {
    if (isCurrent()) await loadQueues(roomId);
    stopButtonLoading(button);
  }
}

async function handleCallAgain(queueId, button) {
  if (!queueId) return;
  const queue = taState.queues.find((q) => q.queue_id === queueId);
  const serving = queue?.serving;
  startButtonLoading(button, 'Calling…');
  try {
    const res = await apiPost('./api/ta/call_again.php', {
      queue_id: queueId,
      ta_name: taState.me?.name || '',
      student_name: serving?.student_name || '',
    });
    if (res?.success) {
      showToast('Call sent to projector.');
    } else {
      const message = res?.message || res?.error;
      throw new Error(message || 'Failed to notify projector.');
    }
  } catch (err) {
    console.error('call again failed', err);
    const message = err?.message || 'Failed to notify projector.';
    showToast(message);
  } finally {
    stopButtonLoading(button);
  }
}

async function loadStudentProgress(userId) {
  if (!taState.selectedCourse || !userId) return;
  const courseId = taState.selectedCourse;
  const request = Symbol();
  taState.progressRequest = request;
  const area = document.getElementById('taProgressArea');
  if (area?.dataset.student !== String(userId) || area?.dataset.course !== String(courseId)) {
    document.getElementById('taStudentPanel')?.classList.add('hidden');
  }
  try {
    const data = await apiGet(`./api/ta/student_progress.php?course_id=${encodeURIComponent(courseId)}&user_id=${encodeURIComponent(userId)}`);
    if (taState.progressRequest !== request || taState.selectedStudent !== userId || taState.selectedCourse !== courseId) return;
    renderStudentPanel(data, userId);
  } catch (err) {
    if (taState.progressRequest === request && taState.selectedStudent === userId) {
      showToast('Could not load student progress. Select the student to retry.');
    }
  }
}

function renderStudentPanel(data, userId) {
  const panel = document.getElementById('taStudentPanel');
  const empty = document.getElementById('taEmptyPanel');
  if (!panel || !empty) return;
  empty.classList.add('hidden');
  panel.classList.remove('hidden');

  const student = findStudentInQueues(userId);
  const nameEl = document.getElementById('taStudentName');
  const fallbackName = taState.studentDirectory?.[userId] || `Student #${userId}`;
  if (nameEl) nameEl.textContent = student?.name || fallbackName;
  const courseLabel = document.getElementById('taStudentCourse');
  if (courseLabel) courseLabel.textContent = taState.selectedCourse ? `Course #${taState.selectedCourse}` : '';

  taState.statusOptions = Array.isArray(data?.statuses) ? data.statuses : [];
  taState.signoffPolicy = data?.signoffPolicy;
  const area = document.getElementById('taProgressArea');
  if (area) {
    area.dataset.student = String(userId);
    area.dataset.course = String(taState.selectedCourse);
  }
  renderProgressList(data);
  renderCommentList(data?.comments || []);
}

function renderProgressList(data) {
  const container = document.getElementById('taProgressArea');
  if (!container) return;
  container.innerHTML = '';
  const categories = Array.isArray(data?.categories) ? data.categories : [];
  const detailsByCategory = data?.detailsByCategory || {};
  const statuses = data?.userStatuses || {};
  const options = buildStatusOptions();

  if (!categories.length) {
    container.innerHTML = '<div class="ta-queue-empty">No progress items configured for this course.</div>';
    return;
  }

  categories.forEach((cat) => {
    const wrapper = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'ta-progress-category';
    title.textContent = cat.name;
    wrapper.appendChild(title);
    const group = document.createElement('div');
    group.className = 'ta-progress-group';
    const items = detailsByCategory[cat.category_id] || [];
    items.forEach((detail) => {
      const row = document.createElement('div');
      row.className = 'ta-progress-item';
      const name = document.createElement('div');
      name.className = 'detail-name';
      name.textContent = detail.name;
      const select = document.createElement('select');
      select.dataset.detail = detail.detail_id;
      select.setAttribute('aria-label', `Progress for ${detail.name}`);
      options.forEach((optName) => {
        const opt = document.createElement('option');
        opt.value = optName;
        opt.textContent = optName;
        if ((statuses && statuses[detail.detail_id]) === optName) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
      select.value = options.includes(statuses[detail.detail_id]) ? statuses[detail.detail_id] : 'None';
      select.dataset.savedStatus = select.value;
      row.appendChild(name);
      row.appendChild(select);
      group.appendChild(row);
    });
    wrapper.appendChild(group);
    container.appendChild(wrapper);
  });
}

function renderCommentList(comments) {
  const list = document.getElementById('taCommentList');
  if (!list) return;
  list.innerHTML = '';
  if (!comments.length) {
    list.innerHTML = '<div class="ta-queue-empty">No comments yet.</div>';
    return;
  }
  comments.forEach((comment) => {
    const card = document.createElement('div');
    card.className = 'ta-comment';
    const meta = document.createElement('div');
    meta.className = 'ta-comment-meta';
    const name = comment.ta_name || 'TA';
    meta.textContent = `${name} · ${formatTime(comment.created_at)}`;
    const text = document.createElement('div');
    text.textContent = comment.text || '';
    card.appendChild(meta);
    card.appendChild(text);
    list.appendChild(card);
  });
}

function prependComment(comment) {
  const list = document.getElementById('taCommentList');
  if (!list) return;
  if (!list.childElementCount || list.firstElementChild?.classList.contains('ta-queue-empty')) {
    list.innerHTML = '';
  }
  const card = document.createElement('div');
  card.className = 'ta-comment';
  const meta = document.createElement('div');
  meta.className = 'ta-comment-meta';
  const name = comment.ta_name || (taState.me?.name ?? 'TA');
  meta.textContent = `${name} · ${formatTime(comment.created_at)}`;
  const text = document.createElement('div');
  text.textContent = comment.text || '';
  card.appendChild(meta);
  card.appendChild(text);
  list.prepend(card);
}

function clearStudentPanel() {
  taState.selectedStudent = null;
  const panel = document.getElementById('taStudentPanel');
  const empty = document.getElementById('taEmptyPanel');
  if (panel) panel.classList.add('hidden');
  if (empty) empty.classList.remove('hidden');
  const list = document.getElementById('taCommentList');
  if (list) list.innerHTML = '';
  const progress = document.getElementById('taProgressArea');
  if (progress) progress.innerHTML = '';
}

async function saveProgress(select, detailId, studentId, status, previous, fields) {
  const response = await apiPost('./api/ta/update_progress.php', {
    user_id: studentId,
    detail_id: detailId,
    status,
    expected_status: previous.toLowerCase(),
    ...fields,
  });
  select.value = response.status;
  select.dataset.savedStatus = response.status;
  showToast('Progress saved.');
}

function confirmSignoff(select, detailId, studentId, status, previous, policy) {
  const dialog = document.getElementById('taSignoffDialog');
  const form = document.getElementById('taSignoffForm');
  const rating = document.getElementById('taSignoffRating');
  const comment = document.getElementById('taSignoffComment');
  const error = document.getElementById('taSignoffError');
  const save = document.getElementById('taSignoffSave');
  const cancel = document.getElementById('taSignoffCancel');
  const courseId = taState.selectedCourse;
  form.reset();
  error.textContent = '';
  document.getElementById('taSignoffTask').textContent = select.closest('.ta-progress-item').querySelector('.detail-name').textContent;
  document.getElementById('taSignoffRatingField').hidden = !policy.options.length;
  document.getElementById('taSignoffRatingLabel').textContent = policy.rating_required ? 'Rating (required)' : 'Rating (optional)';
  document.getElementById('taSignoffCommentLabel').textContent = policy.comment_required ? 'Comment (required)' : 'Comment (optional)';
  rating.replaceChildren(new Option('Select a rating', ''), ...policy.options.map(option => new Option(option.label, option.id)));
  rating.required = policy.rating_required;
  comment.required = policy.comment_required;
  cancel.onclick = () => dialog.close();
  dialog.oncancel = (event) => {
    if (save.disabled) event.preventDefault();
  };
  return new Promise((resolve, reject) => {
    let conflict;
    dialog.onclose = () => {
      form.onsubmit = null;
      if (conflict) reject(conflict);
      else resolve();
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      if (taState.selectedStudent !== studentId || taState.selectedCourse !== courseId) {
        dialog.close();
        return;
      }
      if (policy.comment_required && !comment.value.trim()) {
        error.textContent = 'Enter a comment to complete this task.';
        comment.focus();
        return;
      }
      save.disabled = cancel.disabled = true;
      error.textContent = 'Saving…';
      try {
        await saveProgress(select, detailId, studentId, status, previous, {
          rating_option_id: rating.value || null,
          comment: comment.value,
          policy_revision: policy.revision,
        });
        dialog.close();
      } catch (err) {
        if (err.status === 409) {
          conflict = err;
          dialog.close();
        } else {
          error.textContent = err.body?.message || 'Could not save the sign-off. Try again.';
        }
      } finally {
        save.disabled = cancel.disabled = false;
      }
    };
    dialog.showModal();
  });
}

function highlightSelectedStudent() {
  document.querySelectorAll('.ta-student-item').forEach((li) => {
    const uid = parseInt(li.dataset.userId || '0', 10);
    if (taState.selectedStudent && uid === taState.selectedStudent) {
      li.classList.add('active');
    } else {
      li.classList.remove('active');
    }
  });
}

function findStudentInQueues(userId) {
  for (const queue of taState.queues) {
    if (queue?.serving && queue.serving.student_user_id === userId) {
      return {
        user_id: queue.serving.student_user_id,
        name: queue.serving.student_name,
        joined_at: queue.serving.started_at || null,
      };
    }
    for (const occ of queue.occupants || []) {
      if (occ.user_id === userId) return occ;
    }
  }
  return null;
}

function buildStatusOptions() {
  const options = ['None', 'Pending', 'Completed', 'Review'];
  taState.statusOptions.forEach((row) => {
    if (!row?.name) return;
    const name = row.name;
    if (!options.includes(name)) options.push(name);
  });
  return options;
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

async function apiGet(url) {
  const res = await fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    const err = new Error(`${url} -> ${res.status}`);
    err.status = res.status;
    err.body = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text();
    throw err;
  }
  if (!contentType.includes('application/json')) return {};
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    const err = new Error(`${url} -> ${res.status}`);
    err.status = res.status;
    err.body = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text();
    throw err;
  }
  if (!contentType.includes('application/json')) return {};
  return res.json();
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString([], { hour: '2-digit', minute: '2-digit', hour12: true, month: 'short', day: 'numeric' });
}

function showToast(message, { tone = 'info' } = {}) {
  if (!toastStack) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (tone === 'error') {
    toast.classList.add('toast-error');
  }
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
