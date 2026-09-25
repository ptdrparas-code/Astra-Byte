const $ = (selector) => document.querySelector(selector);
const authView = $('#auth-view');
const mailView = $('#mail-view');
const loginError = $('#login-error');
const profileError = $('#profile-error');
const composeError = $('#compose-error');
const toast = $('#toast');
let currentUser = null;
let currentFolder = 'inbox';
let messages = [];
let toastTimer;
let selectedFile = null;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 404) throw new Error('This feature is not connected to the server yet. The account and messaging API still needs to be added.');
    if (response.status === 401) throw new Error('Wrong credentials. Check your mobile number and password, then try again.');
    throw new Error(data?.error || data?.message || `Request failed (${response.status}).`);
  }
  return data || {};
}

function toastMessage(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.style.background = isError ? '#a94750' : '#2b3040';
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  const span = button.querySelector('span');
  if (span && label) span.textContent = busy ? 'Please wait…' : label;
}

function showLogin(error = '') {
  currentUser = null;
  mailView.hidden = true;
  authView.hidden = false;
  $('#login-card').hidden = false;
  $('#profile-card').hidden = true;
  loginError.textContent = error;
  $('#login-mobile').focus();
}

function showProfile() {
  authView.hidden = false;
  mailView.hidden = true;
  $('#login-card').hidden = true;
  $('#profile-card').hidden = false;
  profileError.textContent = '';
  $('#full-name').focus();
}

function showMailbox(user) {
  currentUser = user || {};
  authView.hidden = true;
  mailView.hidden = false;
  const name = currentUser.name || 'Niti member';
  const firstName = name.trim().split(/\s+/)[0] || 'there';
  const email = currentUser.email || currentUser.address || 'member@niti.com';
  $('#account-name').textContent = name;
  $('#account-address').textContent = email;
  $('#account-avatar').textContent = firstName.slice(0, 1).toUpperCase();
  $('#greeting-name').textContent = firstName;
  const hour = new Date().getHours();
  $('#mail-title').childNodes[0].textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('#mail-date').textContent = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  loadMessages();
}

async function boot() {
  $('#auth-year').textContent = new Date().getFullYear();
  $('#mail-year').textContent = new Date().getFullYear();
  try {
    const result = await api('/api/auth/me');
    if (result.user && result.user.profileComplete !== false) showMailbox(result.user);
    else if (result.authenticated) showProfile();
    else showLogin();
  } catch {
    showLogin();
  }
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const button = $('#login-submit');
  const mobile = $('#login-mobile').value.trim();
  const password = $('#login-password').value;
  if (!mobile || !password) return;
  setBusy(button, true, 'Continue');
  try {
    const result = await api('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, password }),
    });
    if (result.requiresProfileCompletion || result.user?.profileComplete === false) showProfile();
    else if (result.user) showMailbox(result.user);
    else loginError.textContent = 'The sign-in response was incomplete. Please try again.';
  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    setBusy(button, false, 'Continue');
  }
});

$('#resend-code').addEventListener('click', async () => {
  const mobile = $('#login-mobile').value.trim();
  if (!mobile) {
    loginError.textContent = 'Enter your registered mobile number first.';
    $('#login-mobile').focus();
    return;
  }
  loginError.textContent = '';
  try {
    await api('/api/auth/request-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile }),
    });
    toastMessage('If this number belongs to a Niti account, a sign-in code has been sent.');
  } catch (error) {
    loginError.textContent = error.message;
  }
});

$('#login-password').parentElement.querySelector('.show-password').addEventListener('click', (event) => {
  const input = $('#login-password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  event.currentTarget.textContent = show ? 'Hide' : 'Show';
});

$('#birth-date').addEventListener('change', () => {
  const value = $('#birth-date').value;
  if (!value) return;
  const birth = new Date(`${value}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age--;
  $('#age-display').textContent = age >= 0 && age <= 125 ? `Age: ${age} years (calculated from your birth date)` : 'Enter a valid date of birth.';
});

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  profileError.textContent = '';
  const name = $('#full-name').value.trim();
  const dateOfBirth = $('#birth-date').value;
  if (!name || !dateOfBirth || new Date(`${dateOfBirth}T00:00:00`) >= new Date()) {
    profileError.textContent = 'Enter your name and a valid date of birth in the past.';
    return;
  }
  const button = $('#profile-submit');
  setBusy(button, true, 'Finish setup');
  try {
    const result = await api('/api/auth/complete-profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dateOfBirth, gender: $('#gender').value || null }),
    });
    if (result.user) showMailbox(result.user);
    else profileError.textContent = 'Profile could not be confirmed. Please try again.';
  } catch (error) {
    profileError.textContent = error.message;
  } finally {
    setBusy(button, false, 'Finish setup');
  }
});

function setFolder(folder) {
  currentFolder = folder;
  document.querySelectorAll('.folder').forEach((button) => button.classList.toggle('active', button.dataset.folder === folder));
  const titles = { inbox: 'INBOX', starred: 'STARRED', sent: 'SENT', drafts: 'DRAFTS', archive: 'ARCHIVE', trash: 'TRASH' };
  $('#folder-title').textContent = titles[folder] || folder.toUpperCase();
  $('#mail-title').textContent = folder === 'inbox' ? `Good morning, ${currentUser?.name?.trim().split(/\s+/)[0] || 'there'}.` : `${titles[folder][0]}${titles[folder].slice(1).toLowerCase()}`;
  $('#mail-subtitle').textContent = folder === 'inbox' ? 'A little space for the things worth reading.' : `Your ${folder} messages, all in one place.`;
  loadMessages();
}

async function loadMessages() {
  if (mailView.hidden) return;
  const list = $('#mail-list');
  $('#empty-inbox').hidden = true;
  list.hidden = false;
  list.innerHTML = '<div class="mail-loading"><span class="loader"></span>Loading your messages…</div>';
  const query = new URLSearchParams({ folder: currentFolder });
  try {
    const result = await api(`/api/mail/messages?${query}`);
    messages = Array.isArray(result.messages) ? result.messages : [];
    renderMessages();
  } catch (error) {
    list.innerHTML = '';
    const message = document.createElement('div');
    message.className = 'mail-service-error';
    const strong = document.createElement('strong');
    strong.textContent = 'Your mailbox isn’t connected yet';
    const detail = document.createElement('p');
    detail.textContent = error.message;
    message.append(strong, detail);
    list.append(message);
    $('#results-count').textContent = '';
  }
}

function renderMessages() {
  const list = $('#mail-list');
  const search = $('#search-input').value.trim().toLowerCase();
  const visible = messages.filter((message) => !search || [message.fromName, message.from, message.subject, message.body].some((value) => String(value || '').toLowerCase().includes(search)));
  list.replaceChildren();
  $('#results-count').textContent = visible.length ? `${visible.length} message${visible.length === 1 ? '' : 's'}` : '';
  if (!visible.length) {
    list.hidden = true;
    $('#empty-inbox').hidden = false;
    $('#empty-copy').textContent = currentFolder === 'inbox' ? 'Your inbox is clear for now. Messages from Niti members will show up here.' : `There are no messages in ${currentFolder} right now.`;
    $('#inbox-count').textContent = '';
    return;
  }
  list.hidden = false;
  $('#empty-inbox').hidden = true;
  if (currentFolder === 'inbox') {
    const unreadCount = messages.filter((message) => !message.read).length;
    $('#inbox-count').textContent = unreadCount || '';
  }
  const tones = ['lavender', 'peach', 'mint', 'blue'];
  visible.forEach((message, index) => {
    const row = document.createElement('article');
    row.className = `mail-row${message.read ? '' : ' unread'}`;
    row.setAttribute('tabindex', '0');
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Message from ${message.fromName || message.from || 'Niti member'}: ${message.subject || 'No subject'}`);
    const checkbox = document.createElement('span'); checkbox.className = 'mail-check'; checkbox.setAttribute('aria-hidden', 'true');
    const star = document.createElement('button'); star.type = 'button'; star.className = `star-button${message.starred ? ' starred' : ''}`; star.textContent = message.starred ? '★' : '☆'; star.setAttribute('aria-label', message.starred ? 'Remove star' : 'Star message');
    star.addEventListener('click', (event) => { event.stopPropagation(); updateMessage(message, { starred: !message.starred }); });
    const avatar = document.createElement('span'); avatar.className = `sender-avatar ${tones[index % tones.length]}`; avatar.textContent = String(message.fromName || message.from || 'N').trim().slice(0, 1).toUpperCase();
    const main = document.createElement('span'); main.className = 'mail-row-main';
    const sender = document.createElement('span'); sender.className = 'mail-sender'; sender.textContent = message.fromName || message.from || 'Niti member';
    const subject = document.createElement('span'); subject.className = 'mail-subject'; subject.textContent = message.subject || '(no subject)';
    const snippet = document.createElement('span'); snippet.className = 'mail-snippet'; snippet.textContent = message.snippet || message.body || '';
    main.append(sender, subject, snippet);
    if (message.hasAttachment) { const attachment = document.createElement('span'); attachment.className = 'mail-attachment'; attachment.textContent = '↧ Attachment'; main.append(attachment); }
    const date = document.createElement('time'); date.className = 'mail-row-date'; date.textContent = formatDate(message.createdAt);
    row.append(checkbox, star, avatar, main, date);
    row.addEventListener('click', () => openMessage(message));
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMessage(message); } });
    list.append(row);
  });
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const today = new Date();
  return date.toDateString() === today.toDateString() ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function openMessage(message) {
  const backdrop = document.createElement('div'); backdrop.className = 'message-backdrop'; backdrop.setAttribute('role', 'presentation');
  const dialog = document.createElement('section'); dialog.className = 'message-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  const head = document.createElement('header'); head.className = 'message-dialog-head';
  const title = document.createElement('h2'); title.textContent = message.subject || '(no subject)';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Close message'); close.addEventListener('click', () => backdrop.remove());
  head.append(title, close);
  const meta = document.createElement('div'); meta.className = 'message-meta';
  const sender = document.createElement('strong'); sender.textContent = message.fromName || message.from || 'Niti member';
  const address = document.createElement('span'); address.textContent = message.from || '';
  const time = document.createElement('time'); time.textContent = message.createdAt ? new Date(message.createdAt).toLocaleString() : '';
  meta.append(sender, address, time);
  const body = document.createElement('div'); body.className = 'message-body'; body.textContent = message.body || '';
  dialog.append(head, meta, body);
  if (message.attachmentUrl && message.attachmentName) { const link = document.createElement('a'); link.className = 'message-attachment'; link.href = message.attachmentUrl; link.textContent = `↧ ${message.attachmentName}`; link.rel = 'noopener'; dialog.append(link); }
  backdrop.append(dialog); backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
  if (!message.read && message.id) updateMessage(message, { read: true });
}

async function updateMessage(message, patch) {
  if (!message.id) return;
  try {
    await api(`/api/mail/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    Object.assign(message, patch);
    renderMessages();
  } catch (error) { toastMessage(error.message, true); }
}

document.querySelectorAll('.folder').forEach((button) => button.addEventListener('click', () => {
  setFolder(button.dataset.folder);
  $('#mail-sidebar').classList.remove('open');
}));
$('#search-input').addEventListener('input', renderMessages);
$('#refresh-mail').addEventListener('click', loadMessages);
$('#select-all').addEventListener('change', (event) => {
  document.querySelectorAll('.mail-check').forEach((item) => { item.style.background = event.target.checked ? '#6e5ee7' : ''; item.style.borderColor = event.target.checked ? '#6e5ee7' : ''; });
});

function showCompose() {
  $('#compose-error').textContent = '';
  $('#compose-backdrop').hidden = false;
  $('#recipient').focus();
}
function closeCompose() { $('#compose-backdrop').hidden = true; }
$('#compose-open').addEventListener('click', showCompose);
$('#empty-compose').addEventListener('click', showCompose);
$('#compose-close').addEventListener('click', closeCompose);
$('#compose-backdrop').addEventListener('click', (event) => { if (event.target === $('#compose-backdrop')) closeCompose(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeCompose(); document.querySelector('.message-backdrop')?.remove(); } });
$('#attach-button').addEventListener('click', () => $('#attachment-input').click());
$('#attachment-input').addEventListener('change', () => {
  const file = $('#attachment-input').files[0];
  if (file && file.size > 20 * 1024 * 1024) {
    selectedFile = null; $('#attachment-input').value = ''; $('#attachment-name').textContent = 'File exceeds the 20 MB limit'; toastMessage('Choose a file smaller than 20 MB.', true); return;
  }
  selectedFile = file || null;
  $('#attachment-name').textContent = selectedFile ? `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(1)} MB` : 'Documents and media · 20 MB max';
});

$('#compose-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  composeError.textContent = '';
  const to = $('#recipient').value.trim().toLowerCase();
  if (!to.endsWith('@niti.com')) { composeError.textContent = 'Send messages only to registered @niti.com members.'; return; }
  const formData = new FormData();
  formData.append('to', to);
  formData.append('subject', $('#subject').value.trim());
  formData.append('body', $('#message-body').value.trim());
  if (selectedFile) formData.append('attachment', selectedFile);
  const button = $('#send-button'); button.disabled = true; button.textContent = 'Sending…';
  try {
    await api('/api/mail/messages', { method: 'POST', body: formData });
    closeCompose(); $('#compose-form').reset(); selectedFile = null; $('#attachment-name').textContent = 'Documents and media · 20 MB max';
    toastMessage('Message sent.');
    if (currentFolder === 'sent') loadMessages();
  } catch (error) { composeError.textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = 'Send message <b>→</b>'; }
});

$('#account-button').addEventListener('click', () => { $('#account-menu').hidden = !$('#account-menu').hidden; });
$('#logout-button').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* Clear the current view even if the session has expired. */ }
  $('#account-menu').hidden = true;
  showLogin();
});
$('#mobile-sidebar-toggle').addEventListener('click', () => $('#mail-sidebar').classList.toggle('open'));
document.addEventListener('click', (event) => {
  if (!$('#mail-sidebar').contains(event.target) && event.target !== $('#mobile-sidebar-toggle')) $('#mail-sidebar').classList.remove('open');
  if (!$('#account-button').contains(event.target) && !$('#account-menu').contains(event.target)) $('#account-menu').hidden = true;
});

boot();
