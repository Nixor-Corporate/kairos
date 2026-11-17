let APP_CONFIG = window.SignoffConfig || window.SIGNOFF_CONFIG || {};
let CLIENT_ID = typeof APP_CONFIG.googleClientId === 'string' ? APP_CONFIG.googleClientId : '';
let ALLOWED_DOMAIN = typeof APP_CONFIG.allowedDomain === 'string' ? APP_CONFIG.allowedDomain : '';
function setAppConfig(config) {
  APP_CONFIG = config || {};
  CLIENT_ID = typeof APP_CONFIG.googleClientId === 'string' ? APP_CONFIG.googleClientId : '';
  ALLOWED_DOMAIN = typeof APP_CONFIG.allowedDomain === 'string' ? APP_CONFIG.allowedDomain : '';
}
let currentUser = null;
let activeCourseId = null;
let activeCourseName = '';
let lastSearchTerm = '';
let sessionRoles = {};

function updateAllowedDomainCopy() {
  const domain = (typeof ALLOWED_DOMAIN === 'string' && ALLOWED_DOMAIN)
    ? ALLOWED_DOMAIN.replace(/^@+/, '')
    : '';
  const display = domain ? `@${domain}` : 'your organization';
  document.querySelectorAll('[data-allowed-domain-text]').forEach((el) => {
    el.textContent = display;
  });
  updateCourseSettingsPlaceholders();
}


function updateCourseSettingsPlaceholders() {
  const domain = (typeof ALLOWED_DOMAIN === 'string' && ALLOWED_DOMAIN)
    ? ALLOWED_DOMAIN.replace(/^@+/, '')
    : 'example.com';
  const placeholder = `name@${domain}`;
  const allow = document.getElementById('allowlistEmailInput');
  const pre = document.getElementById('preenrollEmailInput');
  if (allow) allow.placeholder = placeholder;
  if (pre) pre.placeholder = placeholder;
}

function showSignin() {
  const signin = document.getElementById('signin');
  if (signin) signin.classList.remove('hidden');
  const userbar = document.getElementById('userbar');
  if (userbar) userbar.classList.add('hidden');
  const sidebarUser = document.querySelector('.k-sidebar__user');
  if (sidebarUser) sidebarUser.classList.add('hidden');
  document.querySelectorAll('.view').forEach(v => { v.classList.add('hidden'); });
  const btn = document.getElementById('googleBtn');
  if (btn) btn.innerHTML = '';
  renderGoogleButton();
  const forbidden = document.getElementById('managerForbidden');
  if (forbidden) forbidden.classList.add('hidden');
  closeProgressModal();
}

function showApp() {
  const signin = document.getElementById('signin');
  if (signin) signin.classList.add('hidden');
  const userbar = document.getElementById('userbar');
  if (userbar) userbar.classList.remove('hidden');
  const sidebarUser = document.querySelector('.k-sidebar__user');
  if (sidebarUser) sidebarUser.classList.remove('hidden');
  const forbidden = document.getElementById('managerForbidden');
  if (forbidden) forbidden.classList.add('hidden');
}

function showForbidden() {
  const signin = document.getElementById('signin');
  if (signin) signin.classList.add('hidden');
  document.querySelectorAll('.view').forEach(v => { v.classList.add('hidden'); });
  const forbidden = document.getElementById('managerForbidden');
  if (forbidden) forbidden.classList.remove('hidden');
  const userbar = document.getElementById('userbar');
  if (userbar) userbar.classList.remove('hidden');
  const sidebarUser = document.querySelector('.k-sidebar__user');
  if (sidebarUser) sidebarUser.classList.remove('hidden');
  closeProgressModal();
}

async function handleCredentialResponse(resp) {
  try {
    if (!window.KairosAuth) throw new Error('Sign-in services are unavailable.');
    await window.KairosAuth.post('./api/auth.php', { credential: resp.credential });
    await bootstrap();
  } catch (err) {
    alert('Login failed: ' + err.message);
    showSignin();
  }
}

function renderGoogleButton() {
  if (!window.google || !google.accounts?.id) {
    setTimeout(renderGoogleButton, 120);
    return;
  }
  if (!CLIENT_ID) {
    console.error('Google client ID is not configured.');
    const btn = document.getElementById('googleBtn');
    if (btn && !btn.textContent.trim()) {
      btn.innerHTML = '<p class="muted small">Sign-in is temporarily unavailable.</p>';
    }
    return;
  }
  if (!renderGoogleButton._init) {
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: handleCredentialResponse,
      ux_mode: 'popup',
      auto_select: false,
      itp_support: true
    });
    renderGoogleButton._init = true;
  }
  const btn = document.getElementById('googleBtn');
  if (btn && !btn.hasChildNodes()) {
    google.accounts.id.renderButton(btn, {
      theme: 'outline', size: 'large', shape: 'rectangular', text: 'signin_with', logo_alignment: 'left'
    });
  }
}

async function bootstrap() {
  try {
    let me = null;
    sessionRoles = null;
    if (window.KairosIdentity) {
      const session = await window.KairosIdentity.fetchSession();
      if (session) {
        me = session.me;
        sessionRoles = session.caps;
      }
    }
    if (!me) {
      const r = await fetch('./api/me.php', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('me.php ' + r.status);
      me = await r.json();
    }
    if (!me || !me.email) {
      showSignin();
      return;
    }
    currentUser = me;
    const avatarEl = document.getElementById('kSidebarAvatar') || document.getElementById('avatar');
    const nameEl = document.getElementById('kSidebarName') || document.getElementById('name');
    const emailEl = document.getElementById('kSidebarRole') || document.getElementById('email');
    if (avatarEl) {
      const initials = window.KairosIdentity ? window.KairosIdentity.getInitials(me.name, me.email) : '?';
      avatarEl.src = me.picture_url || (window.KairosIdentity ? window.KairosIdentity.getAvatarSvg(initials) : '');
      avatarEl.onerror = () => {
        if (window.KairosIdentity) avatarEl.src = window.KairosIdentity.getAvatarSvg(initials);
        avatarEl.onerror = null;
      };
    }
    if (nameEl) nameEl.textContent = me.name || me.email || '';
    if (emailEl) {
      let roleLabel = 'Manager';
      if (sessionRoles) {
        if (sessionRoles.admin) roleLabel = 'Admin';
        else if (sessionRoles.manager) roleLabel = 'Manager';
        else if (sessionRoles.ta) roleLabel = 'TA';
        else roleLabel = 'Student';
      }
      emailEl.textContent = roleLabel;
    }
    showApp();
    if (!sessionRoles) {
      try {
        const rawCaps = await apiGet('./api/session_capabilities.php');
        sessionRoles = normalizeSessionRoles(rawCaps);
      } catch (err) {
        if (err?.status === 401 || err?.status === 403) throw err;
        sessionRoles = {};
      }
    }
    if (typeof window.updateSidebarRoleLinks === 'function') {
      window.updateSidebarRoleLinks(sessionRoles);
    }
    if (window.KairosIdentity) {
      window.KairosIdentity.me = me;
      window.KairosIdentity.caps = sessionRoles;
      window.KairosIdentity.loading = false;
      window.KairosIdentity.render();
    }
    updateNavAvailability();
    if (window.SignoffWS) {
      if (me.user_id != null) {
        window.SignoffWS.setSelfUserId(Number(me.user_id));
      }
      window.SignoffWS.init({
        getFilters: () => ({ courseId: activeCourseId ? Number(activeCourseId) : null }),
        onRooms: () => { if (activeCourseId) loadRooms().catch(() => { }); },
        onQueue: () => { if (activeCourseId) loadRooms().catch(() => { }); },
      });
    }
    await loadCourses();
  } catch (err) {
    console.warn('bootstrap failed', err);
    showSignin();
  }
}

function updateNavAvailability() {
  const rosterBtn = document.getElementById('navRoster');
  const progressBtn = document.getElementById('navProgress');
  const assignmentLink = document.getElementById('navAssignments');
  const hasCourse = Boolean(activeCourseId);

  if (rosterBtn) {
    rosterBtn.disabled = !hasCourse;
    rosterBtn.setAttribute('aria-disabled', String(!hasCourse));
  }
  if (progressBtn) {
    progressBtn.disabled = !hasCourse;
    progressBtn.setAttribute('aria-disabled', String(!hasCourse));
  }
  if (assignmentLink) {
    assignmentLink.classList.toggle('hidden', !sessionRoles?.admin);
  }
}

function openRosterView() {
  if (!activeCourseId) {
    loadCourses();
    return;
  }
  setBreadcrumbs(`Course #${activeCourseId}`);
  showView('viewCourseDetail');
}

async function openProgressView() {
  if (!activeCourseId) {
    loadCourses();
    return;
  }
  setBreadcrumbs(`Course #${activeCourseId} · Progress`);
  showView('viewProgress');
  document.getElementById('downloadProgressExcel').onclick = downloadProgressWorkbook;
  await Promise.all([loadProgressSummary(), loadSignoffRequirements(activeCourseId)]);
}

async function downloadProgressWorkbook() {
  const courseId = activeCourseId;
  const courseName = activeCourseName || `Course #${courseId}`;
  const button = document.getElementById('downloadProgressExcel');
  const message = document.getElementById('progressExportMessage');
  if (!courseId || button.disabled) return;
  button.disabled = true;
  message.textContent = `Preparing workbook for ${courseName}…`;
  try {
    const response = await fetch(`./api/manager/progress_export.php?course_id=${encodeURIComponent(courseId)}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Could not download the workbook. Check your course access and try again.');
    }
    if (!response.headers.get('Content-Type')?.startsWith('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
      throw new Error('The server did not return a workbook.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `kairos-course-${courseId}-progress.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.textContent = `Workbook for ${courseName} sent to your downloads.`;
  } catch (err) {
    message.textContent = err.message || 'Could not download the workbook.';
  } finally {
    button.disabled = false;
  }
}

async function loadSignoffRequirements(courseId) {
  const form = document.getElementById('managerSignoffForm');
  const status = document.getElementById('managerSignoffMessage');
  const list = document.getElementById('managerRatingOptions');
  const rating = document.getElementById('managerRatingRequired');
  const comment = document.getElementById('managerCommentRequired');
  const add = document.getElementById('managerAddRating');
  const save = document.getElementById('managerSaveSignoff');
  if (!form) return;
  const request = Symbol();
  form.signoffRequest = request;
  const isCurrent = () => activeCourseId === courseId && form.signoffRequest === request;
  form.hidden = true;
  const taskForm = document.getElementById('managerTaskSignoffForm');
  if (taskForm) taskForm.hidden = true;
  status.textContent = 'Loading requirements…';
  let policy;
  const refreshAddButton = () => { add.disabled = list.children.length >= 50; };
  const appendChoice = (option = { id: null, label: '', active: true }) => {
    const item = document.createElement('li');
    item.className = 'k-toolbar';
    if (option.id) item.dataset.id = option.id;
    const label = document.createElement('input');
    label.className = 'input';
    label.setAttribute('aria-label', 'Rating label');
    label.required = true;
    label.maxLength = 120;
    label.value = option.label;
    const activeLabel = document.createElement('label');
    const active = document.createElement('input');
    active.type = 'checkbox';
    active.checked = option.active;
    activeLabel.append(active, ' Active');
    item.append(label, activeLabel);
    for (const [title, move] of [
      ['Move up', () => { if (item.previousElementSibling) list.insertBefore(item, item.previousElementSibling); }],
      ['Move down', () => { if (item.nextElementSibling) list.insertBefore(item.nextElementSibling, item); }],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary btn-sm';
      button.textContent = title;
      button.setAttribute('aria-label', `${title} rating choice`);
      button.onclick = () => { move(); button.focus(); };
      item.append(button);
    }
    if (!option.id) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-sm';
      remove.textContent = 'Remove';
      remove.onclick = () => { item.remove(); refreshAddButton(); add.focus(); };
      item.append(remove);
    }
    list.append(item);
    refreshAddButton();
    return label;
  };
  const applyPolicy = (data) => {
    policy = data;
    rating.checked = data.rating_required;
    comment.checked = data.comment_required;
    list.replaceChildren();
    data.options.forEach(appendChoice);
    refreshAddButton();
  };
  try {
    const response = await fetch(`./api/manager/signoff_policy.php?course_id=${encodeURIComponent(courseId)}&include_tasks=1`, { cache: 'no-store' });
    if (!isCurrent()) return;
    if (!response.ok) throw new Error('Could not load sign-off requirements.');
    const data = await response.json();
    if (!isCurrent()) return;
    applyPolicy(data);
    bindTaskSignoffSettings(courseId, data.tasks, isCurrent);
    form.hidden = false;
    status.textContent = '';
    add.onclick = () => appendChoice().focus();
  } catch (err) {
    if (isCurrent()) status.textContent = 'Could not load sign-off requirements. Reopen Student progress to retry.';
    return;
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (save.disabled || !isCurrent()) return;
    const options = [...list.children].map(item => ({
      id: item.dataset.id || null,
      label: item.querySelector('input[type=text], input:not([type])').value,
      active: item.querySelector('input[type=checkbox]').checked,
    }));
    const fields = [...form.elements];
    fields.forEach(field => { field.disabled = true; });
    status.textContent = 'Saving requirements…';
    try {
      const response = await fetch('./api/manager/signoff_policy.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id: courseId,
          revision: policy.revision,
          rating_required: rating.checked,
          comment_required: comment.checked,
          options,
        }),
      });
      const data = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(data.message || 'Could not save sign-off requirements.');
      applyPolicy(data);
      status.textContent = 'Requirements saved.';
    } catch (err) {
      if (isCurrent()) status.textContent = err.message;
    } finally {
      fields.forEach(field => { field.disabled = false; });
      if (isCurrent()) refreshAddButton();
    }
  };
}

function bindTaskSignoffSettings(courseId, tasks, isCurrent) {
  const form = document.getElementById('managerTaskSignoffForm');
  if (!form) return;
  const task = document.getElementById('managerSignoffTask');
  const fields = document.getElementById('managerTaskSignoffFields');
  const rating = document.getElementById('managerTaskRating');
  const comment = document.getElementById('managerTaskComment');
  const source = document.getElementById('managerTaskChoiceSource');
  const choices = document.getElementById('managerTaskChoices');
  const choicesField = document.getElementById('managerTaskChoicesField');
  const reset = document.getElementById('managerResetTaskSignoff');
  const status = document.getElementById('managerTaskSignoffMessage');
  const catalog = Array.isArray(tasks) ? tasks : [];
  task.replaceChildren(new Option('Select a task', ''), ...catalog.map(item =>
    new Option(`${item.category} · ${item.name}`, item.detail_id)));
  task.disabled = catalog.length === 0;
  form.hidden = false;
  fields.hidden = true;
  fields.disabled = true;
  status.textContent = catalog.length ? '' : 'No progress tasks are available.';
  let request;
  let settings;
  const endpoint = './api/manager/signoff_policy.php';
  const syncChoices = () => {
    choicesField.hidden = source.value !== 'custom';
  };
  const apply = (data) => {
    settings = data;
    const { overrides, defaults } = data;
    for (const [control, key] of [[rating, 'rating_required'], [comment, 'comment_required']]) {
      control.replaceChildren(
        new Option(`Inherit course default (${defaults[key] ? 'required' : 'optional'})`, 'inherit'),
        new Option('Require for this task', 'true'),
        new Option('Optional for this task', 'false')
      );
      control.value = overrides[key] === null ? 'inherit' : String(overrides[key]);
    }
    source.value = overrides.options === null ? 'inherit' : 'custom';
    choices.value = overrides.options?.join('\n') ?? '';
    reset.disabled = Object.values(overrides).every(value => value === null);
    syncChoices();
    fields.hidden = false;
    fields.disabled = false;
  };
  const exchange = async (url, options) => {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Could not load or save the task requirements.');
    return data;
  };
  task.onchange = async () => {
    const load = Symbol();
    request = load;
    settings = null;
    fields.hidden = true;
    fields.disabled = true;
    const detailId = task.value;
    status.textContent = detailId ? 'Loading task requirements…' : '';
    if (!detailId || !isCurrent()) return;
    try {
      const data = await exchange(`${endpoint}?course_id=${encodeURIComponent(courseId)}&detail_id=${encodeURIComponent(detailId)}`, { cache: 'no-store' });
      if (!isCurrent() || request !== load) return;
      apply(data);
      status.textContent = '';
    } catch (error) {
      if (isCurrent() && request === load) status.textContent = error.message;
    }
  };
  source.onchange = syncChoices;

  const saveTask = async (restoreDefaults) => {
    if (!settings || fields.disabled || !isCurrent()) return;
    const save = request;
    const parseRequirement = value => value === 'inherit' ? null : value === 'true';
    const body = {
      course_id: courseId,
      detail_id: task.value,
      revision: settings.revision,
      task_revision: settings.task_revision,
      rating_required: restoreDefaults ? null : parseRequirement(rating.value),
      comment_required: restoreDefaults ? null : parseRequirement(comment.value),
      options: restoreDefaults || source.value === 'inherit' ? null
        : choices.value.split(/\r?\n/).map(label => label.trim()).filter(Boolean),
    };
    fields.disabled = true;
    status.textContent = 'Saving task requirements…';
    try {
      const data = await exchange(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!isCurrent() || request !== save) return;
      apply(data);
      status.textContent = restoreDefaults ? 'Task now uses the course defaults.' : 'Task requirements saved.';
    } catch (error) {
      if (isCurrent() && request === save) {
        status.textContent = error.message;
        fields.disabled = false;
      }
    }
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    saveTask(false);
  };
  reset.onclick = () => saveTask(true);
}

async function loadProgressSummary() {
  if (!activeCourseId) return;
  const tbody = document.querySelector('#progressTable tbody');
  const meta = document.getElementById('progressCourseMeta');
  const title = document.getElementById('progressTitle');
  if (title) {
    title.textContent = `${activeCourseName || 'Course'} progress`;
  }
  if (meta) {
    meta.textContent = `Course #${activeCourseId}`;
  }
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Loading progress…</td></tr>';
  }
  try {
    const data = await apiGet(`./api/manager/progress.php?course_id=${encodeURIComponent(activeCourseId)}`);
    const roster = Array.isArray(data?.students) ? data.students : [];
    if (!tbody) return;
    if (!roster.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No enrolled students.</td></tr>';
      return;
    }
    tbody.innerHTML = roster.map((student) => {
      const name = escapeHtml(student.name || 'User #' + student.user_id);
      const email = escapeHtml(student.email || '');
      const progress = escapeHtml(student.progress_summary || 'No progress yet');
      const updated = student.last_updated ? formatTimestamp(student.last_updated) : '—';
      return `
        <tr>
          <td>${name}</td>
          <td>${email}</td>
          <td>${progress}</td>
          <td>${escapeHtml(updated)}</td>
          <td><button class="btn btn-secondary btn-sm" data-progress-user="${student.user_id}">View</button></td>
        </tr>
      `;
    }).join('');
    tbody.onclick = async (event) => {
      const btn = event.target.closest('button[data-progress-user]');
      if (!btn) return;
      const uid = Number(btn.getAttribute('data-progress-user'));
      if (!uid) return;
      await openProgressModal(uid);
    };
  } catch (err) {
    if (!tbody) return;
    if (err?.status === 403) {
      return;
    }
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Failed to load progress: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function openProgressModal(userId) {
  if (!activeCourseId || !userId) return;
  const courseId = activeCourseId;
  const modal = document.getElementById('progressModal');
  const title = document.getElementById('progressModalTitle');
  const meta = document.getElementById('progressModalMeta');
  const body = document.getElementById('progressModalBody');
  if (!modal || !title || !meta || !body) return;

  if (!modal.open) modal.showModal();
  const request = Symbol();
  modal.progressRequest = request;
  body.innerHTML = '<div class="muted">Loading progress details…</div>';

  try {
    const data = await apiGet(`./api/manager/progress.php?course_id=${encodeURIComponent(courseId)}&user_id=${encodeURIComponent(userId)}`);
    if (!modal.open || modal.progressRequest !== request || courseId !== activeCourseId) return;
    title.textContent = data?.student?.name
      ? `${data.student.name} — progress`
      : 'Student progress';
    meta.textContent = data?.student?.email
      ? `${data.student.email} · Course #${activeCourseId}`
      : `Course #${activeCourseId}`;

    const categories = Array.isArray(data?.categories) ? data.categories : [];
    const detailsByCategory = data?.detailsByCategory || {};
    const statuses = data?.userStatuses || {};
    const comments = Array.isArray(data?.comments) ? data.comments : [];
    const history = Array.isArray(data?.signoffHistory) ? data.signoffHistory : [];

    const categoryHtml = categories.map((cat) => {
      const details = Array.isArray(detailsByCategory?.[cat.category_id]) ? detailsByCategory[cat.category_id] : [];
      const detailHtml = details.length
        ? details.map((detail) => {
          const status = statuses?.[detail.detail_id] || 'None';
          return `
            <div class="progress-detail">
              <div>${escapeHtml(detail.name || '')}</div>
              <div class="progress-status">${escapeHtml(status)}</div>
            </div>
          `;
        }).join('')
        : '<div class="muted">No details yet.</div>';
      return `
        <div class="progress-category">
          <h4>${escapeHtml(cat.name || '')}</h4>
          <div class="progress-detail-list">${detailHtml}</div>
        </div>
      `;
    }).join('');

    const commentHtml = comments.length
      ? `
        <div class="progress-comments">
          ${comments.map((comment) => `
            <div class="progress-comment">
              <div>${escapeHtml(comment.text || '')}</div>
              <div class="muted small">${escapeHtml(comment.ta_name || 'TA')} · ${escapeHtml(formatTimestamp(comment.created_at || ''))}</div>
            </div>
          `).join('')}
        </div>
      `
      : '<div class="muted">No comments yet.</div>';

    body.innerHTML = `
      ${categoryHtml || '<div class="muted">No progress categories configured for this course.</div>'}
      <div>
        <h4 class="title-reset">TA comments</h4>
        ${commentHtml}
      </div>
      <div>
        <h4 class="title-reset">Recent sign-offs</h4>
        ${history.length ? history.map(event => `
          <div class="progress-comment">
            <div>${escapeHtml(event.task_name || `Task #${event.detail_id}`)} · ${escapeHtml(event.status)}</div>
            <div class="muted small">${escapeHtml(event.actor_name || 'Staff')} · ${escapeHtml(formatTimestamp(event.created_at))}</div>
            ${event.rating_label ? `<div>Rating: ${escapeHtml(event.rating_label)}</div>` : ''}
            ${event.signoff_comment ? `<div>${escapeHtml(event.signoff_comment)}</div>` : ''}
          </div>`).join('') : '<div class="muted">No sign-off history yet.</div>'}
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div class="muted">Failed to load progress details: ${escapeHtml(err.message)}</div>`;
  }
}

function closeProgressModal() {
  const modal = document.getElementById('progressModal');
  if (!modal) return;
  if (modal.open) modal.close();
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function setBreadcrumbs(text) {
  const el = document.getElementById('breadcrumbs');
  if (el) el.textContent = text;
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => { v.classList.toggle('hidden', v.id !== id); });
  const navCourses = document.getElementById('navCourses');
  const navRoster = document.getElementById('navRoster');
  const navProgress = document.getElementById('navProgress');
  if (navCourses) navCourses.classList.toggle('is-active', id === 'viewCourses');
  if (navRoster) navRoster.classList.toggle('is-active', id === 'viewCourseDetail');
  if (navProgress) navProgress.classList.toggle('is-active', id === 'viewProgress');
}

async function apiGet(url) {
  const r = await fetch(url, { credentials: 'same-origin', headers: { 'Cache-Control': 'no-cache' } });
  if (r.status === 401) {
    showSignin();
    throw new Error('unauthenticated');
  }
  if (r.status === 403) {
    showForbidden();
    const msg = await safeErrorMessage(r);
    throw Object.assign(new Error(msg || 'forbidden'), { status: 403 });
  }
  if (!r.ok) {
    const msg = await safeErrorMessage(r);
    const error = new Error(msg || (url + ' -> ' + r.status));
    error.status = r.status;
    throw error;
  }
  return r.json();
}

async function apiPost(url, payload) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  if (r.status === 401) {
    showSignin();
    throw new Error('unauthenticated');
  }
  if (r.status === 403) {
    showForbidden();
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.error) {
    const msg = data?.message || data?.error || (url + ' -> ' + r.status);
    const error = new Error(msg);
    error.status = r.status;
    error.body = data;
    throw error;
  }
  return data;
}

async function safeErrorMessage(response) {
  try {
    const data = await response.json();
    return data?.message || data?.error;
  } catch (_) {
    return null;
  }
}

async function loadCourses() {
  activeCourseId = null;
  activeCourseName = '';
  if (window.SignoffWS) {
    window.SignoffWS.updateFilters({ courseId: null });
  }
  setBreadcrumbs('Courses');
  showView('viewCourses');
  updateNavAvailability();
  const grid = document.getElementById('coursesGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="card">Loading…</div>';
  try {
    const courses = await apiGet('./api/manager/courses.php');
    if (!Array.isArray(courses) || !courses.length) {
      grid.innerHTML = '<div class="card"><strong>No managed courses.</strong><div class="muted small">You are not enrolled as a manager yet.</div></div>';
      return;
    }
    grid.innerHTML = '';
    courses.forEach(course => {
      const card = document.createElement('div');
      card.className = 'course-card';
      card.innerHTML = `
        <span class="badge">Course #${course.course_id}</span>
        <h3 class="course-title">${escapeHtml(course.name || '')}</h3>
        <div class="mt-8">
          <button class="btn btn-primary" data-open-course="${course.course_id}" data-course-name="${escapeHtmlAttr(course.name || '')}">Open</button>
        </div>
      `;
      grid.appendChild(card);
    });
    grid.onclick = onCourseGridClick;
  } catch (err) {
    if (err?.status === 403) {
      return;
    }
    grid.innerHTML = `<div class="card">Failed to load courses.<br/><span class="muted small">${escapeHtml(err.message)}</span></div>`;
  }
}

function onCourseGridClick(event) {
  const btn = event.target.closest('button[data-open-course]');
  if (!btn) return;
  const id = btn.getAttribute('data-open-course');
  const name = btn.getAttribute('data-course-name') || '';
  openCourse(id, name);
}

async function openCourse(courseId, courseName) {
  activeCourseId = Number(courseId);
  activeCourseName = courseName;
  if (window.SignoffWS) {
    window.SignoffWS.updateFilters({ courseId: activeCourseId });
  }
  setBreadcrumbs(`Course #${activeCourseId}`);
  const courseTitleEl = document.getElementById('courseTitle');
  if (courseTitleEl) courseTitleEl.textContent = `${courseName || 'Course'} (#${activeCourseId})`;
  showView('viewCourseDetail');
  updateNavAvailability();
  await Promise.all([loadRooms(), loadRoster(), loadCourseSettings()]);
  const hash = (window.location.hash || '').toLowerCase();
  if (hash.includes('progress')) {
    await openProgressView();
  }

  restoreManagerLayout();
}

async function loadRooms() {
  if (!activeCourseId) return;
  const container = document.getElementById('roomsList');
  if (!container) return;
  container.innerHTML = '<div class="muted">Loading rooms…</div>';
  try {
    const rooms = await apiGet(`./api/rooms.php?course_id=${encodeURIComponent(activeCourseId)}`);
    if (!Array.isArray(rooms) || !rooms.length) {
      container.innerHTML = '<div class="muted">No rooms yet. Create one to start managing queues.</div>';
      return;
    }
    const queueData = await Promise.all(rooms.map(r => apiGet(`./api/queues.php?room_id=${encodeURIComponent(r.room_id)}`)
      .catch(() => [])));
    container.innerHTML = '';
    rooms.forEach((room, idx) => {
      const queues = Array.isArray(queueData[idx]) ? queueData[idx] : [];
      container.appendChild(renderRoom(room, queues));
    });
  } catch (err) {
    if (err?.status === 403) {
      return;
    }
    container.innerHTML = `<div class="muted">Failed to load rooms: ${escapeHtml(err.message)}</div>`;
  }
}

function renderRoom(room, queues) {
  const wrapper = document.createElement('div');
  wrapper.className = 'room-entry';
  wrapper.dataset.roomId = room.room_id;
  wrapper.innerHTML = `
    <div class="room-header">
      <div>
        <span class="badge">Room #${room.room_id}</span>
        <h3 class="title">${escapeHtml(room.name || '')}</h3>
      </div>
      <div class="room-actions">
        <button class="btn btn-secondary" data-room-action="add-queue" data-room-id="${room.room_id}">+ Queue</button>
        <button class="btn btn-secondary" data-room-action="rename" data-room-id="${room.room_id}" data-room-name="${escapeHtmlAttr(room.name || '')}">Rename</button>
        <button class="btn btn-danger" data-room-action="delete" data-room-id="${room.room_id}">Delete</button>
      </div>
    </div>
    <div class="queue-list">${queues.map(renderQueueHtml).join('')}</div>
  `;
  wrapper.addEventListener('click', onRoomActionClick);
  return wrapper;
}

function renderQueueHtml(queue) {
  const occupants = Array.isArray(queue.occupants) ? queue.occupants : [];
  const pills = occupants.length
    ? `<div class="occupant-pills">${occupants.map(o => `<span class="pill">${escapeHtml(o.name || 'User #' + o.user_id)}</span>`).join('')}</div>`
    : '<div class="muted">No one in queue.</div>';
  return `
    <div class="queue-item" data-queue-id="${queue.queue_id}">
      <div class="queue-head">
        <span class="badge">Queue #${queue.queue_id}</span>
        <div class="queue-details">
          <div class="queue-name">${escapeHtml(queue.name || '')}</div>
          <div class="queue-meta">${escapeHtml(queue.description || '')}</div>
        </div>
        <div class="room-actions">
          <button class="btn btn-secondary" data-queue-action="rename" data-queue-id="${queue.queue_id}" data-queue-name="${escapeHtmlAttr(queue.name || '')}" data-queue-desc="${escapeHtmlAttr(queue.description || '')}">Rename</button>
          <button class="btn btn-danger" data-queue-action="delete" data-queue-id="${queue.queue_id}">Delete</button>
        </div>
      </div>
      <div>
        <div class="muted text-small">${occupants.length} in queue</div>
        ${pills}
      </div>
    </div>
  `;
}

async function onRoomActionClick(event) {
  const btn = event.target.closest('button[data-room-action], button[data-queue-action]');
  if (!btn) return;
  event.preventDefault();
  const roomAction = btn.getAttribute('data-room-action');
  const queueAction = btn.getAttribute('data-queue-action');
  try {
    if (roomAction) {
      const roomId = Number(btn.getAttribute('data-room-id'));
      if (roomAction === 'add-queue') {
        await createQueue(roomId);
      } else if (roomAction === 'rename') {
        const currentName = btn.getAttribute('data-room-name') || '';
        await renameRoom(roomId, currentName);
      } else if (roomAction === 'delete') {
        await deleteRoom(roomId);
      }
    } else if (queueAction) {
      const queueId = Number(btn.getAttribute('data-queue-id'));
      if (queueAction === 'rename') {
        const name = btn.getAttribute('data-queue-name') || '';
        const desc = btn.getAttribute('data-queue-desc') || '';
        await renameQueue(queueId, name, desc);
      } else if (queueAction === 'delete') {
        await deleteQueue(queueId);
      }
    }
    await loadRooms();
  } catch (err) {
    if (err?.status !== 403) {
      alert(err.message);
    }
  }
}

async function createQueue(roomId) {
  const name = prompt('Queue name');
  if (!name) return;
  const description = prompt('Queue description (optional)') || '';
  await apiPost('./api/manager/queues.php', {
    action: 'create',
    room_id: roomId,
    name,
    description
  });
}

async function renameQueue(queueId, currentName, currentDesc) {
  const name = prompt('New queue name', currentName || '');
  if (!name) return;
  const description = prompt('New description (optional)', currentDesc || '') ?? '';
  await apiPost('./api/manager/queues.php', {
    action: 'rename',
    queue_id: queueId,
    name,
    description
  });
}

async function deleteQueue(queueId) {
  if (!confirm('Delete this queue? This cannot be undone.')) return;
  await apiPost('./api/manager/queues.php', {
    action: 'delete',
    queue_id: queueId
  });
}

async function renameRoom(roomId, currentName) {
  const name = prompt('New room name', currentName || '');
  if (!name) return;
  await apiPost('./api/manager/rooms.php', {
    action: 'rename',
    room_id: roomId,
    name
  });
}

async function deleteRoom(roomId) {
  if (!confirm('Delete this room and all its queues?')) return;
  await apiPost('./api/manager/rooms.php', {
    action: 'delete',
    room_id: roomId
  });
}

async function createRoom() {
  if (!activeCourseId) return;
  const name = prompt('Room name');
  if (!name) return;
  await apiPost('./api/manager/rooms.php', {
    action: 'create',
    course_id: activeCourseId,
    name
  });
  await loadRooms();
}

async function loadRoster() {
  if (!activeCourseId) return;
  const courseId = activeCourseId;
  const rosterEl = document.getElementById('courseRoster');
  if (!rosterEl) return;
  rosterEl.innerHTML = '<div class="muted">Loading roster…</div>';
  rosterEl.onclick = null;
  try {
    const roster = await apiGet(`./api/manager/users_search.php?course_id=${encodeURIComponent(courseId)}&roster=1`);
    if (activeCourseId !== courseId) return;
    if (!Array.isArray(roster) || !roster.length) {
      rosterEl.innerHTML = '<div class="muted">No one enrolled yet.</div>';
      return;
    }
    rosterEl.innerHTML = '';
    roster.forEach(user => {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `
        <div class="meta">
          <span>${escapeHtml(user.name || 'User #' + user.user_id)}</span>
          <span>${escapeHtml(user.email || '')}</span>
        </div>
        <div class="list-row-actions">
          <button class="btn btn-secondary" data-roster-progress="${user.user_id}">View progress</button>
          <button class="btn btn-danger" data-roster-remove="${user.user_id}">Remove</button>
        </div>
      `;
      rosterEl.appendChild(row);
    });
    rosterEl.onclick = async (event) => {
      if (activeCourseId !== courseId) return;
      const btn = event.target.closest('button[data-roster-remove]');
      if (btn) {
        const uid = Number(btn.getAttribute('data-roster-remove'));
        if (!confirm('Unenroll this user?')) return;
        try {
          await apiPost('./api/manager/unenroll.php', { user_id: uid, course_id: courseId });
          if (activeCourseId === courseId) await Promise.all([loadRoster(), rerunLastSearch()]);
        } catch (err) {
          if (err?.status !== 403) {
            alert(err.message);
          }
        }
        return;
      }

      const progressBtn = event.target.closest('button[data-roster-progress]');
      if (!progressBtn) return;
      const uid = Number(progressBtn.getAttribute('data-roster-progress'));
      if (!uid) return;
      await openProgressModal(uid);
    };
  } catch (err) {
    if (activeCourseId !== courseId || err?.status === 403) {
      return;
    }
    rosterEl.innerHTML = `<div class="muted">Failed to load roster: ${escapeHtml(err.message)}</div>`;
  }
}

async function searchUsers() {
  const courseId = activeCourseId;
  if (!activeCourseId) return;
  const input = document.getElementById('userSearchInput');
  const term = (input.value || '').trim();
  const isEmailSearch = term.includes('@');
  if (!isEmailSearch && term.length < 2) {
    alert('Enter at least 2 characters to search by name.');
    return;
  }
  if (isEmailSearch && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(term)) {
    alert('Enter a full email address to search by email.');
    return;
  }
  lastSearchTerm = term;
  const resultsEl = document.getElementById('userSearchResults');
  resultsEl.innerHTML = '<div class="muted">Searching…</div>';
  resultsEl.onclick = null;
  try {
    const results = await apiGet(`./api/manager/users_search.php?course_id=${encodeURIComponent(courseId)}&q=${encodeURIComponent(term)}`);
    if (activeCourseId !== courseId || lastSearchTerm !== term) return;
    if (!Array.isArray(results) || !results.length) {
      resultsEl.innerHTML = '<div class="muted">No results.</div>';
      return;
    }
    resultsEl.innerHTML = '';
    results.forEach(user => {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `
        <div class="meta">
          <span>${escapeHtml(user.name || 'User #' + user.user_id)}</span>
          <span>${escapeHtml(user.email || '')}</span>
        </div>
        <button class="btn btn-primary" data-search-action="enroll" data-user-id="${user.user_id}">Enroll</button>
      `;
      resultsEl.appendChild(row);
    });
    resultsEl.onclick = async (event) => {
      if (activeCourseId !== courseId) return;
      const btn = event.target.closest('button[data-search-action]');
      if (!btn) return;
      const uid = Number(btn.getAttribute('data-user-id'));
      const action = btn.getAttribute('data-search-action');
      try {
        if (action === 'enroll') {
          await apiPost('./api/manager/enroll.php', { user_id: uid, course_id: courseId });
        }
        if (activeCourseId === courseId) await Promise.all([loadRoster(), rerunLastSearch()]);
      } catch (err) {
        if (err?.status !== 403) {
          alert(err.message);
        }
      }
    };
  } catch (err) {
    if (activeCourseId !== courseId || lastSearchTerm !== term || err?.status === 403) {
      return;
    }
    resultsEl.innerHTML = `<div class="muted">Search failed: ${escapeHtml(err.message)}</div>`;
  }
}

async function rerunLastSearch() {
  if (lastSearchTerm && activeCourseId) {
    const input = document.getElementById('userSearchInput');
    input.value = lastSearchTerm;
    await searchUsers();
  }
}


async function loadCourseSettings() {
  if (!activeCourseId) return;
  const visibilitySelect = document.getElementById('courseVisibilitySelect');
  const preenrollEntries = document.getElementById('preenrollEntries');
  if (!visibilitySelect || !preenrollEntries) return;

  let courseMeta = null;
  let preenrollData = null;

  try {
    courseMeta = await apiGet(`./api/lms/courses.php?course_id=${encodeURIComponent(activeCourseId)}`);
  } catch (err) {
    console.warn('Failed to load course settings', err);
    return; // If course info fails, nothing to render
  }

  try {
    preenrollData = await apiGet(`./api/lms/courses/preenroll.php?course_id=${encodeURIComponent(activeCourseId)}`);
  } catch (err) {
    console.warn('Failed to load preenroll data', err);
  }

  visibilitySelect.value = (courseMeta?.data?.visibility || courseMeta?.visibility || 'public');

  const preEntries = Array.isArray(preenrollData?.data?.entries) ? preenrollData.data.entries : [];
  preenrollEntries.innerHTML = preEntries.length
    ? preEntries.map((entry) => `<div class="list-row"><div class="meta"><span>${escapeHtml(entry.email || '')}</span><span class="muted small">${escapeHtml(entry.status || 'unclaimed')}</span></div><button class="btn btn-link" data-remove-preenroll="${Number(entry.id || 0)}">Remove</button></div>`).join('')
    : '<div class="muted">No pre-enroll emails.</div>';
}

function getManagerLayoutKey() {
  const uid = currentUser?.user_id || currentUser?.email || 'guest';
  return `kairos_manager_ui_${uid}_${activeCourseId}`;
}

function restoreManagerLayout() {
  const container = document.getElementById('managerCardsContainer');
  if (!container) return;
  const sections = Array.from(container.querySelectorAll('.manager-section'));

  const isManager = Boolean(sessionRoles?.admin || sessionRoles?.manager);
  const hasReorderRights = Boolean(sessionRoles?.admin || sessionRoles?.manager);

  sections.forEach(sec => {
    const handle = sec.querySelector('.drag-handle');
    if (handle) handle.style.display = hasReorderRights ? 'inline-block' : 'none';
  });

  const defaultOrder = ['settings', 'rooms', 'enrollment'];
  let prefs = { order: defaultOrder, collapsed: {} };
  try {
    const stored = localStorage.getItem(getManagerLayoutKey());
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed.order)) prefs.order = parsed.order;
      if (parsed.collapsed) prefs.collapsed = parsed.collapsed;
    }
  } catch (e) { }

  // Restore order
  const orderMap = {};
  prefs.order.forEach((id, idx) => { orderMap[id] = idx; });

  sections.sort((a, b) => {
    const idA = a.dataset.section;
    const idB = b.dataset.section;
    const idxA = orderMap[idA] !== undefined ? orderMap[idA] : 999;
    const idxB = orderMap[idB] !== undefined ? orderMap[idB] : 999;
    return idxA - idxB;
  });

  sections.forEach(sec => {
    container.appendChild(sec);
  });

  // Restore collapsed
  sections.forEach(sec => {
    const sectionId = sec.dataset.section;
    const isCollapsed = prefs.collapsed[sectionId] || false;
    sec.classList.toggle('collapsed', isCollapsed);
    const btn = sec.querySelector('.section-toggle');
    if (btn) btn.setAttribute('aria-expanded', !isCollapsed);

    const bodyWrapper = sec.querySelector('.section-body');
    if (bodyWrapper) {
      bodyWrapper.inert = isCollapsed;
      bodyWrapper.setAttribute('aria-hidden', String(isCollapsed));
    }
  });

  if (!container.dataset.interactionsInit) {
    setupManagerInteractions(container, hasReorderRights);
    container.dataset.interactionsInit = "true";
  }
}

function saveManagerLayout() {
  if (!activeCourseId) return;
  const container = document.getElementById('managerCardsContainer');
  if (!container) return;
  const sections = Array.from(container.querySelectorAll('.manager-section'));

  const order = sections.map(s => s.dataset.section);
  const collapsed = {};
  sections.forEach(s => {
    collapsed[s.dataset.section] = s.classList.contains('collapsed');
  });

  const prefs = { order, collapsed };
  try {
    localStorage.setItem(getManagerLayoutKey(), JSON.stringify(prefs));
  } catch (err) {
    console.warn('Failed to save manager layout to localStorage', err);
  }
}

function setupManagerInteractions(container, hasReorderRights) {
  container.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.section-toggle');
    const titleObj = e.target.closest('.title-reset');

    // Toggle if they clicked the chevron button or the section title
    if (toggleBtn || titleObj) {
      const parentHead = (toggleBtn || titleObj).closest('.draggable-head');
      if (!parentHead) return;

      const realBtn = parentHead.querySelector('.section-toggle');
      const section = parentHead.closest('.manager-section');

      if (section && realBtn) {
        const isCollapsed = section.classList.toggle('collapsed');
        realBtn.setAttribute('aria-expanded', !isCollapsed);

        const bodyWrapper = section.querySelector('.section-body');
        if (bodyWrapper) {
          bodyWrapper.inert = isCollapsed;
          bodyWrapper.setAttribute('aria-hidden', String(isCollapsed));
        }

        saveManagerLayout();
      }
    }
  });

  if (!hasReorderRights) return;

  let draggedEl = null;

  container.addEventListener('dragstart', (e) => {
    const section = e.target.closest('.manager-section');
    if (!section) return;

    // Ensure only dragging from header
    if (!e.target.closest('.draggable-head')) {
      e.preventDefault();
      return;
    }

    draggedEl = section;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', section.dataset.section);
    setTimeout(() => section.classList.add('dragging'), 0);
  });

  container.addEventListener('dragend', (e) => {
    if (!draggedEl) return;
    draggedEl.classList.remove('dragging');
    draggedEl = null;
    saveManagerLayout();
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault(); // Necessary to allow dropping
    if (!draggedEl) return;

    const targetSection = e.target.closest('.manager-section');
    if (targetSection && targetSection !== draggedEl) {
      const rect = targetSection.getBoundingClientRect();
      const midPoint = rect.top + rect.height / 2;
      if (e.clientY < midPoint) {
        container.insertBefore(draggedEl, targetSection);
      } else {
        container.insertBefore(draggedEl, targetSection.nextSibling);
      }
    }
  });

  // Make headers draggable
  container.querySelectorAll('.draggable-head').forEach(head => {
    head.setAttribute('draggable', 'true');
  });
}
function showToast(message, { tone = 'info' } = {}) {
  const stack = document.getElementById('toastStack');
  if (!stack) {
    console.log(message);
    return;
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (tone === 'error') toast.classList.add('toast-error');
  toast.textContent = message;
  stack.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str ?? '').replace(/[&<>"']/g, ch => map[ch] || ch);
}

function escapeHtmlAttr(str) {
  return escapeHtml(str);
}

function setupEvents() {
  (document.getElementById('kLogoutBtn') || document.getElementById('logoutBtn'))?.addEventListener('click', async () => {
    await fetch('./api/logout.php', { method: 'POST', credentials: 'same-origin' });
    showSignin();
    renderGoogleButton();
  });
  document.getElementById('navCourses')?.addEventListener('click', () => loadCourses());
  document.getElementById('navRoster')?.addEventListener('click', () => openRosterView());
  document.getElementById('navProgress')?.addEventListener('click', () => openProgressView());
  document.getElementById('backToCourses')?.addEventListener('click', () => loadCourses());
  document.getElementById('backToCourseDetail')?.addEventListener('click', () => openRosterView());
  document.getElementById('addRoomBtn')?.addEventListener('click', async () => {
    try {
      await createRoom();
    } catch (err) {
      alert(err.message);
    }
  });
  document.getElementById('searchUsersBtn')?.addEventListener('click', () => searchUsers());
  document.getElementById('userSearchInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchUsers();
    }
  });

  document.getElementById('saveCourseVisibilityBtn')?.addEventListener('click', async () => {
    if (!activeCourseId) return;
    const visibility = document.getElementById('courseVisibilitySelect')?.value || 'public';
    try {
      await apiPost('./api/lms/courses/visibility.php', { course_id: activeCourseId, visibility });
      showToast('Course visibility updated.', { tone: 'success' });
      await loadCourseSettings();
    } catch (err) {
      showToast(`Failed to update visibility: ${err.message}`, { tone: 'error' });
    }
  });

  document.getElementById('addPreenrollBtn')?.addEventListener('click', async () => {
    if (!activeCourseId) return;
    const input = document.getElementById('preenrollEmailInput');
    const email = (input?.value || '').trim();
    if (!email) return;
    try {
      await apiPost('./api/lms/courses/preenroll.php', { course_id: activeCourseId, email });
      input.value = '';
      await loadCourseSettings();
      showToast('Pre-enroll updated.', { tone: 'success' });
    } catch (err) {
      showToast(`Failed to update pre-enroll: ${err.message}`, { tone: 'error' });
    }
  });

  document.getElementById('preenrollEntries')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-remove-preenroll]');
    if (!btn || !activeCourseId) return;
    try {
      const response = await fetch('./api/lms/courses/preenroll.php', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: activeCourseId, id: Number(btn.getAttribute('data-remove-preenroll')) })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.error?.message || body?.message || `Delete failed (${response.status})`);
      }
      await loadCourseSettings();
      showToast('Pre-enroll entry removed.', { tone: 'success' });
    } catch (err) {
      showToast(`Failed to remove pre-enroll entry: ${err.message}`, { tone: 'error' });
    }
  });

  const modal = document.getElementById('progressModal');
  modal?.addEventListener('click', (event) => {
    if (event.target.closest('[data-modal-close]')) {
      closeProgressModal();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const startApp = () => {
    updateAllowedDomainCopy();
    setupEvents();
    bootstrap();
  };

  if (typeof window.waitForAppConfig === 'function') {
    window.waitForAppConfig()
      .then((cfg) => { setAppConfig(cfg); startApp(); })
      .catch(() => {
        setAppConfig(typeof window.getAppConfig === 'function' ? window.getAppConfig() : APP_CONFIG);
        startApp();
      });
  } else {
    startApp();
  }
});
