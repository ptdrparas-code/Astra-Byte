const $ = (selector) => document.querySelector(selector);
const i18n = window.NitiI18n;
const t = (text, values) => i18n.t(text, values);
const languageView = $('#language-view');
const authView = $('#auth-view');
const mailView = $('#mail-view');
const loginError = $('#login-error');
const otpError = $('#otp-error');
const changePasswordError = $('#change-password-error');
const profileError = $('#profile-error');
const composeError = $('#compose-error');
const toast = $('#toast');
let currentUser = null;
let currentFolder = 'inbox';
let currentPage = 'inbox';
let pageHistory = [];
let messages = [];
const selectedMessageIds = new Set();
let toastTimer;
let selectedFile = null;
let userSearchTimer;
let userSearchController;
let userSuggestions = [];
const profileBroadcast = 'BroadcastChannel' in window ? new BroadcastChannel('niti-profile') : null;

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options });
  } catch {
    throw new Error(t('Network connection failed. Check your internet and try again.'));
  }
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 404) throw new Error(t(data?.error || 'The requested item was not found.'));
    if (response.status === 401) throw new Error(t(data?.error || 'Wrong mobile number, email, or password.'));
    throw new Error(data?.error || data?.message ? t(data.error || data.message) : t('Request failed ({status}).', { status: response.status }));
  }
  return data || {};
}

function toastMessage(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = t(message);
  toast.style.background = isError ? '#a94750' : '#2b3040';
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  const span = button.querySelector('span');
  if (span && label) span.textContent = busy ? t('Please wait…') : t(label);
}

function showLogin(error = '') {
  currentUser = null;
  currentFolder = 'inbox';
  currentPage = 'inbox';
  pageHistory = [];
  updateBackButton();
  mailView.hidden = true;
  authView.hidden = false;
  $('#login-card').hidden = false;
  $('#otp-card').hidden = true;
  $('#change-password-card').hidden = true;
  $('#profile-card').hidden = true;
  loginError.textContent = t(error);
  $('#login-mobile').focus();
}

function showOtp(phoneHint = '') {
  currentUser = null;
  mailView.hidden = true;
  authView.hidden = false;
  $('#login-card').hidden = true;
  $('#otp-card').hidden = false;
  $('#change-password-card').hidden = true;
  $('#profile-card').hidden = true;
  $('#otp-intro').textContent = phoneHint
    ? t('Enter the 6-digit code we sent to {phone}. It expires in 5 minutes.', { phone: phoneHint })
    : t('Enter the 6-digit code we sent to your mobile number.');
  otpError.textContent = '';
  $('#otp-code').focus();
}

function showChangePassword() {
  currentUser = null;
  mailView.hidden = true;
  authView.hidden = false;
  $('#login-card').hidden = true;
  $('#otp-card').hidden = true;
  $('#change-password-card').hidden = false;
  $('#profile-card').hidden = true;
  changePasswordError.textContent = '';
  $('#new-password').focus();
}

function showProfile() {
  authView.hidden = false;
  mailView.hidden = true;
  $('#login-card').hidden = true;
  $('#otp-card').hidden = true;
  $('#change-password-card').hidden = true;
  $('#profile-card').hidden = false;
  profileError.textContent = '';
  $('#full-name').focus();
}

function showMailbox(user) {
  hideUserSuggestions();
  currentUser = user || {};
  authView.hidden = true;
  mailView.hidden = false;
  $('#mail-main').hidden = false;
  $('#profile-view').hidden = true;
  const name = currentUser.name || 'Niti member';
  const firstName = name.trim().split(/\s+/)[0] || 'there';
  const email = currentUser.email || currentUser.address || 'member@niti.com';
  $('#account-name').textContent = name;
  $('#account-address').textContent = email;
  setAvatar('#account-avatar', currentUser);
  setAvatar('#top-avatar', currentUser);
  const greetingName = $('#greeting-name');
  if (greetingName) greetingName.textContent = firstName;
  const hour = new Date().getHours();
  if (currentFolder === 'inbox' && $('#mail-title').childNodes[0]?.nodeType === Node.TEXT_NODE) {
    $('#mail-title').childNodes[0].textContent = t(hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
  }
  $('#mail-date').textContent = new Date().toLocaleDateString(i18n.locales[i18n.language], { weekday: 'short', month: 'short', day: 'numeric' });
  $('#profile-display-name').textContent = name;
  $('#profile-display-email').textContent = email;
  $('#profile-display-phone').textContent = currentUser.phoneNumber || '—';
  $('#profile-display-age').textContent = Number.isInteger(currentUser.age) ? `${currentUser.age} ${t('years')}` : '—';
  const genders = { woman: 'Woman', man: 'Man', nonbinary: 'Non-binary', self_describe: 'I describe myself', prefer_not_to_say: 'Prefer not to say' };
  $('#profile-display-gender').textContent = currentUser.gender ? t(genders[currentUser.gender] || 'Not provided') : t('Not provided');
  const profilePhoto = $('#profile-photo');
  profilePhoto.src = currentUser.profilePicture || '';
  profilePhoto.hidden = !currentUser.profilePicture;
  $('#profile-photo-initials').hidden = Boolean(currentUser.profilePicture);
  $('#profile-photo-initials').textContent = firstName.slice(0, 1).toUpperCase();
  loadMessages();
}

function setAvatar(selector, user) {
  const element = $(selector);
  if (!element) return;
  const picture = user?.profilePicture;
  element.textContent = picture ? '' : (user?.name?.trim().slice(0, 1).toUpperCase() || 'N');
  element.style.backgroundImage = picture ? `url("${picture}")` : '';
  element.classList.toggle('has-photo', Boolean(picture));
}

function applyProfilePicture(profilePicture) {
  if (!currentUser) return;
  currentUser.profilePicture = profilePicture || null;
  setAvatar('#account-avatar', currentUser);
  setAvatar('#top-avatar', currentUser);
  $('#profile-photo').src = currentUser.profilePicture || '';
  $('#profile-photo').hidden = !currentUser.profilePicture;
  $('#profile-photo-initials').hidden = Boolean(currentUser.profilePicture);
}

profileBroadcast?.addEventListener('message', async (event) => {
  if (event.data?.type !== 'profile-picture-updated' || !currentUser) return;
  try {
    const result = await api('/api/auth/me');
    if (result.user && result.user.phoneNumber === currentUser.phoneNumber) {
      currentUser = { ...currentUser, ...result.user };
      setAvatar('#account-avatar', currentUser);
      setAvatar('#top-avatar', currentUser);
      $('#profile-photo').src = currentUser.profilePicture || '';
      $('#profile-photo').hidden = !currentUser.profilePicture;
      $('#profile-photo-initials').hidden = Boolean(currentUser.profilePicture);
    }
  } catch { /* Keep the current profile if the other tab's update cannot be loaded. */ }
});

async function showProfilePage(remember = true) {
  try {
    const result = await api('/api/auth/me');
    if (!result.authenticated || !result.user) {
      showLogin('Your session has ended. Sign in again to open your profile.');
      return false;
    }
    // Tabs share the session cookie, so refresh this tab's cached user before showing profile data.
    showMailbox(result.user);
  } catch (error) {
    toastMessage(error.message || 'Could not load your profile.', true);
    return false;
  }
  hideUserSuggestions();
  if (remember && currentPage !== 'profile') pageHistory.push(currentPage);
  currentPage = 'profile';
  $('#mail-main').hidden = true;
  $('#profile-view').hidden = false;
  document.querySelectorAll('[data-folder]').forEach((button) => button.classList.remove('active'));
  $('#top-profile').classList.add('active');
  updateBackButton();
  return true;
}

function updateBackButton() {
  const button = $('#mail-back');
  if (!button) return;
  const disabled = currentPage === 'inbox' || pageHistory.length === 0;
  button.disabled = disabled;
  button.setAttribute('aria-disabled', String(disabled));
}

function finishOpeningSplash() {
  const splash = $('#opening-splash');
  if (!splash) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splash.remove();
    return;
  }

  const target = [
    ...document.querySelectorAll('.topbar-brand-logo, .language-card .site-logo, .auth-art .site-logo, .auth-mobile-brand .site-logo')
  ].find((logo) => logo.getClientRects().length > 0);
  if (!target) {
    splash.remove();
    return;
  }

  const targetBox = target.getBoundingClientRect();
  const logo = splash.querySelector('.opening-splash-logo');
  const coverSize = Math.ceil(Math.max(window.innerWidth, window.innerHeight) * 1.3);
  target.classList.add('opening-splash-target');
  const logoMotion = logo.animate([
    { left: '50%', top: '50%', width: `${coverSize}px`, height: `${coverSize}px`, transform: 'translate(-50%, -50%)' },
    { left: `${targetBox.left}px`, top: `${targetBox.top}px`, width: `${targetBox.width}px`, height: `${targetBox.height}px`, transform: 'none' }
  ], { duration: 1180, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards' });
  const coverMotion = splash.animate([
    { opacity: 1, offset: 0 },
    { opacity: 1, offset: .82 },
    { opacity: 0, offset: 1 }
  ], { duration: 1400, easing: 'ease-out', fill: 'forwards' });

  Promise.all([logoMotion.finished, coverMotion.finished]).then(() => {
    target.classList.remove('opening-splash-target');
    splash.remove();
  }).catch(() => {
    target.classList.remove('opening-splash-target');
    splash.remove();
  });
}

async function goBack() {
  if (currentPage === 'inbox' || !pageHistory.length) return;
  const previousPage = pageHistory[pageHistory.length - 1];
  if (previousPage === 'profile') {
    const restored = await showProfilePage(false);
    if (restored) pageHistory.pop();
    updateBackButton();
    return;
  }
  pageHistory.pop();
  setFolder(previousPage, { remember: false });
}

async function boot() {
  $('#auth-year').textContent = new Date().getFullYear();
  $('#mail-year').textContent = new Date().getFullYear();
  try {
    const otp = await api('/api/auth/otp-status');
    if (otp.pending) {
      showOtp(otp.phoneHint);
      return;
    }
    const result = await api('/api/auth/me');
    if (result.user?.mustChangePassword) showChangePassword();
    else if (result.user && result.user.profileComplete !== false) showMailbox(result.user);
    else if (result.authenticated) showProfile();
    else showLogin();
  } catch {
    showLogin();
  }
}

function continueAfterAuth(result) {
  if (result.user?.mustChangePassword) showChangePassword();
  else if (result.requiresProfileCompletion || result.user?.profileComplete === false) showProfile();
  else if (result.user) showMailbox(result.user);
  else showLogin(t('The sign-in response was incomplete. Please try again.'));
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const button = $('#login-submit');
  const mobile = $('#login-mobile').value.trim();
  const password = $('#login-password').value;
  if (!mobile || !password) return;
  setBusy(button, true, 'Sign in');
  try {
    const result = await api('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, password }),
    });
    if (result.requiresOtp) showOtp();
    else continueAfterAuth(result);
  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    setBusy(button, false, 'Sign in');
  }
});

$('#otp-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  otpError.textContent = '';
  const code = $('#otp-code').value.trim();
  if (!/^\d{6}$/.test(code)) {
    otpError.textContent = t('Enter the 6-digit code sent to your mobile.');
    return;
  }
  const button = $('#otp-submit');
  setBusy(button, true, 'Verify and continue');
  try {
    const result = await api('/api/auth/verify-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    $('#otp-code').value = '';
    continueAfterAuth(result);
  } catch (error) {
    otpError.textContent = error.message;
    if (/expired|sign in again|too many/i.test(error.message)) showLogin(error.message);
  } finally {
    setBusy(button, false, 'Verify and continue');
  }
});

$('#resend-otp').addEventListener('click', async () => {
  otpError.textContent = '';
  try {
    const result = await api('/api/auth/resend-otp', { method: 'POST' });
    toastMessage(t(result.message || 'A new sign-in code was sent.'));
  } catch (error) {
    otpError.textContent = error.message;
    if (/expired|sign in again/i.test(error.message)) showLogin(error.message);
  }
});

$('#otp-back').addEventListener('click', () => showLogin());

$('#change-password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  changePasswordError.textContent = '';
  const password = $('#new-password').value;
  const confirmPassword = $('#confirm-password').value;
  if (password.length < 8 || password.length > 128) {
    changePasswordError.textContent = t('Choose a password between 8 and 128 characters.');
    return;
  }
  if (password !== confirmPassword) {
    changePasswordError.textContent = t('The passwords do not match.');
    return;
  }
  const button = $('#change-password-submit');
  setBusy(button, true, 'Save password');
  try {
    const result = await api('/api/auth/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, confirmPassword }),
    });
    $('#new-password').value = '';
    $('#confirm-password').value = '';
    continueAfterAuth(result);
  } catch (error) {
    changePasswordError.textContent = error.message;
  } finally {
    setBusy(button, false, 'Save password');
  }
});

$('#resend-code').addEventListener('click', async () => {
  const mobile = $('#login-mobile').value.trim();
  if (!mobile) {
    loginError.textContent = t('Enter your registered mobile number first.');
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
  event.currentTarget.textContent = t(show ? 'Hide' : 'Show');
});

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  profileError.textContent = '';
  const name = $('#full-name').value.trim();
  const age = Number($('#profile-age').value);
  if (!name || !Number.isInteger(age) || age < 0 || age > 125) {
    profileError.textContent = t('Enter your name and a valid age between 0 and 125.');
    return;
  }
  const button = $('#profile-submit');
  setBusy(button, true, 'Finish setup');
  try {
    const result = await api('/api/auth/complete-profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, age, gender: $('#gender').value || null }),
    });
    if (result.user) showMailbox(result.user);
    else profileError.textContent = t('Profile could not be confirmed. Please try again.');
  } catch (error) {
    profileError.textContent = error.message;
  } finally {
    setBusy(button, false, 'Finish setup');
  }
});

function setFolder(folder, { remember = true } = {}) {
  selectedMessageIds.clear();
  $('#select-all').checked = false;
  if (folder === 'inbox') {
    pageHistory = [];
  } else if (remember && folder !== currentPage) {
    pageHistory.push(currentPage);
  }
  currentPage = folder;
  currentFolder = folder;
  $('#mail-main').hidden = false;
  $('#profile-view').hidden = true;
  $('#top-profile').classList.remove('active');
  document.querySelectorAll('[data-folder]').forEach((button) => button.classList.toggle('active', button.dataset.folder === folder));
  const titles = { inbox: 'Inbox', starred: 'Starred', sent: 'Sent', drafts: 'Drafts', archive: 'Archive', trash: 'Trash' };
  $('#folder-title').textContent = t(titles[folder] || folder);
  const mailTitle = $('#mail-title');
  mailTitle.replaceChildren();
  if (folder === 'inbox') {
    const comma = document.createElement('span');
    comma.className = 'heading-comma';
    comma.textContent = ',';
    const name = document.createElement('span');
    name.id = 'greeting-name';
    name.textContent = currentUser?.name?.trim().split(/\s+/)[0] || 'there';
    const period = document.createElement('span');
    period.className = 'heading-period';
    period.textContent = '.';
    mailTitle.append(document.createTextNode(t('Good morning')), comma, document.createTextNode(' '), name, period);
  } else {
    mailTitle.append(document.createTextNode(t(titles[folder] || folder)));
  }
  $('#mail-subtitle').textContent = folder === 'inbox' ? t('A little space for the things worth reading.') : t('Your {folder} messages, all in one place.', { folder: t(titles[folder] || folder).toLowerCase() });
  updateBackButton();
  loadMessages();
}

async function loadMessages() {
  if (mailView.hidden) return;
  const list = $('#mail-list');
  $('#empty-inbox').hidden = true;
  list.hidden = false;
  list.innerHTML = `<div class="mail-loading"><span class="loader"></span>${t('Loading your messages…')}</div>`;
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
    strong.textContent = t('Your mailbox isn’t connected yet');
    const detail = document.createElement('p');
    detail.textContent = t(error.message);
    message.append(strong, detail);
    list.append(message);
    $('#results-count').textContent = '';
  }
}

function renderMessages() {
  const list = $('#mail-list');
  const visible = messages;
  const unreadCount = visible.filter((message) => !message.read).length;
  list.replaceChildren();
  const countLabel = unreadCount
    ? t(unreadCount === 1 ? '{count} unread message' : '{count} unread messages', { count: unreadCount })
    : t(visible.length === 1 ? '{count} message' : '{count} messages', { count: visible.length });
  $('#results-count').textContent = visible.length ? countLabel : '';
  updateSelectionControls();
  if (!visible.length) {
    list.hidden = true;
    $('#empty-inbox').hidden = false;
    $('#empty-copy').textContent = currentFolder === 'inbox' ? t('Your inbox is clear for now. Messages from Niti members will show up here.') : t('There are no messages in {folder} right now.', { folder: t(currentFolder[0].toUpperCase() + currentFolder.slice(1)).toLowerCase() });
    $('#inbox-count').textContent = '';
    $('#dock-inbox-count').textContent = '';
    return;
  }
  list.hidden = false;
  $('#empty-inbox').hidden = true;
  if (currentFolder === 'inbox') {
    $('#inbox-count').textContent = unreadCount || '';
    $('#dock-inbox-count').textContent = unreadCount || '';
  }
  const tones = ['lavender', 'peach', 'mint', 'blue'];
  visible.forEach((message, index) => {
    const draftMessage = Boolean(message.isDraft) || currentFolder === 'drafts';
    const sentMessage = !draftMessage && isSentMessage(message);
    const contactName = draftMessage
      ? (message.draftTo || message.to || 'Draft')
      : sentMessage
        ? (message.toName || message.to || 'Niti member')
        : (message.fromName || message.from || 'Niti member');
    const displayName = sentMessage ? contactName.toLocaleUpperCase(i18n.locales[i18n.language]) : contactName;
    const row = document.createElement('article');
    row.className = `mail-row ${draftMessage ? 'draft-message' : sentMessage ? 'sent-message' : 'received-message'}${message.read ? '' : ' unread'}`;
    row.setAttribute('tabindex', '0');
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `${draftMessage ? 'Draft' : sentMessage ? 'Sent to' : 'Message from'} ${contactName}: ${message.subject || 'No subject'}`);
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'mail-check'; checkbox.checked = selectedMessageIds.has(message.id); checkbox.setAttribute('aria-label', `Select message: ${contactName}, ${message.subject || t('No subject')}`);
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedMessageIds.add(message.id);
      else selectedMessageIds.delete(message.id);
      updateSelectionControls();
    });
    const star = document.createElement('button'); star.type = 'button'; star.className = `star-button${message.starred ? ' starred' : ''}`; star.textContent = message.starred ? '★' : '☆'; star.setAttribute('aria-label', t(message.starred ? 'Remove star' : 'Star message'));
    star.addEventListener('click', (event) => { event.stopPropagation(); updateMessage(message, { starred: !message.starred }); });
    const direction = draftMessage ? createDraftIndicator() : createDirectionIndicator(sentMessage);
    const avatar = document.createElement('span'); avatar.className = `sender-avatar ${tones[index % tones.length]}`; avatar.setAttribute('aria-hidden', 'true');
    const initials = document.createElement('span'); initials.textContent = String(displayName || 'N').trim().slice(0, 1); avatar.append(initials);
    if (message.contactPictureUrl) {
      const photo = document.createElement('img'); photo.className = 'sender-avatar-photo'; photo.src = message.contactPictureUrl; photo.alt = ''; photo.loading = 'lazy'; photo.decoding = 'async';
      photo.addEventListener('error', () => photo.remove(), { once: true });
      avatar.append(photo);
    }
    const main = document.createElement('span'); main.className = 'mail-row-main';
    const sender = document.createElement('span'); sender.className = 'mail-sender mail-recipient-name'; sender.textContent = displayName;
    const subject = document.createElement('span'); subject.className = 'mail-subject'; subject.textContent = message.subject || t('No subject');
    const snippet = document.createElement('span'); snippet.className = 'mail-snippet'; snippet.textContent = message.snippet || message.body || '';
    main.append(sender, subject, snippet);
    if (message.hasAttachment) { const attachment = document.createElement('span'); attachment.className = 'mail-attachment'; attachment.textContent = `↧ ${t('Attachment')}`; main.append(attachment); }
    const date = document.createElement('time'); date.className = 'mail-row-date'; date.textContent = formatDate(message.createdAt);
    row.append(checkbox, star, direction, avatar, main, date);
    const activateMessage = () => draftMessage ? showDraft(message) : openMessage(message);
    row.addEventListener('click', activateMessage);
    row.addEventListener('keydown', (event) => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); activateMessage(); } });
    list.append(row);
  });
}

function updateSelectionControls() {
  const selectAll = $('#select-all');
  const selectedCount = messages.reduce((count, message) => count + (selectedMessageIds.has(message.id) ? 1 : 0), 0);
  selectAll.checked = messages.length > 0 && selectedCount === messages.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < messages.length;
  selectAll.disabled = messages.length === 0;
  const deleteButton = $('#delete-selected');
  deleteButton.hidden = selectedCount === 0 || currentFolder === 'trash';
  deleteButton.textContent = selectedCount > 1 ? `${t('Delete')} (${selectedCount})` : t('Delete');
}

async function moveSelectedToTrash() {
  if (currentFolder === 'trash') return;
  const selected = messages.filter((message) => selectedMessageIds.has(message.id));
  if (!selected.length) return;
  const button = $('#delete-selected');
  button.disabled = true;
  try {
    await Promise.all(selected.map((message) => api(`/api/mail/messages/${encodeURIComponent(message.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    })));
    selectedMessageIds.clear();
    messages = messages.filter((message) => !selected.some((item) => item.id === message.id));
    renderMessages();
    toastMessage(selected.length === 1 ? 'Message moved to Trash.' : 'Messages moved to Trash.');
  } catch (error) {
    toastMessage(error.message, true);
    selectedMessageIds.clear();
    await loadMessages();
  } finally {
    button.disabled = false;
  }
}

function isSentMessage(message) {
  return message.direction ? message.direction === 'sent' : currentFolder === 'sent';
}

function createDirectionIndicator(sentMessage) {
  const indicator = document.createElement('span');
  indicator.className = `message-direction-indicator ${sentMessage ? 'direction-sent' : 'direction-received'}`;
  indicator.textContent = sentMessage ? '\u2197' : '\u2199';
  indicator.title = t(sentMessage ? 'Sent' : 'Received');
  indicator.setAttribute('aria-label', sentMessage ? 'Sent message' : 'Received message');
  indicator.setAttribute('role', 'img');
  return indicator;
}

function createDraftIndicator() {
  const indicator = document.createElement('span');
  indicator.className = 'message-direction-indicator direction-draft';
  indicator.textContent = '\u270e';
  indicator.title = t('Draft');
  indicator.setAttribute('aria-label', 'Draft message');
  indicator.setAttribute('role', 'img');
  return indicator;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const today = new Date();
  return date.toDateString() === today.toDateString() ? date.toLocaleTimeString(i18n.locales[i18n.language], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString(i18n.locales[i18n.language], { month: 'short', day: 'numeric' });
}

function openMessage(message) {
  const backdrop = document.createElement('div'); backdrop.className = 'message-backdrop'; backdrop.setAttribute('role', 'presentation');
  const dialog = document.createElement('section'); dialog.className = 'message-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  const head = document.createElement('header'); head.className = 'message-dialog-head';
  const title = document.createElement('h2'); title.textContent = message.subject || t('No subject');
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', t('Close message')); close.addEventListener('click', () => backdrop.remove());
  head.append(title, close);
  const meta = document.createElement('div'); meta.className = 'message-meta';
  const sentMessage = isSentMessage(message);
  const contactName = sentMessage
    ? (message.toName || message.to || 'Niti member')
    : (message.fromName || message.from || 'Niti member');
  const sender = document.createElement('strong');
  sender.textContent = sentMessage ? contactName.toLocaleUpperCase(i18n.locales[i18n.language]) : contactName;
  sender.className = 'mail-recipient-name';
  const address = document.createElement('span'); address.textContent = sentMessage ? (message.to || '') : (message.from || '');
  const time = document.createElement('time'); time.textContent = message.createdAt ? new Date(message.createdAt).toLocaleString(i18n.locales[i18n.language]) : '';
  meta.append(createDirectionIndicator(sentMessage), sender, address, time);
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

document.querySelectorAll('[data-folder]').forEach((button) => button.addEventListener('click', () => {
  setFolder(button.dataset.folder);
  $('#mail-sidebar').classList.remove('open');
}));
$('#top-profile').addEventListener('click', showProfilePage);
$('#mail-back').addEventListener('click', goBack);
$('#profile-photo-edit').addEventListener('click', () => $('#profile-photo-input').click());
$('#profile-photo-input').addEventListener('change', async () => {
  const file = $('#profile-photo-input').files[0];
  if (!file) return;
  $('#profile-photo-input').value = '';
  $('#profile-photo-error').textContent = '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    $('#profile-photo-error').textContent = t('Choose a JPG, PNG, or WebP image.');
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    $('#profile-photo-error').textContent = t('Choose an image smaller than 12 MB.');
    return;
  }
  const editButton = $('#profile-photo-edit');
  editButton.disabled = true;
  editButton.textContent = '…';
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 512 / bitmap.width, 512 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    let dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    if ((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75 > 512 * 1024) {
      const again = await createImageBitmap(file);
      const smallerScale = Math.min(1, 384 / again.width, 384 / again.height);
      canvas.width = Math.max(1, Math.round(again.width * smallerScale));
      canvas.height = Math.max(1, Math.round(again.height * smallerScale));
      canvas.getContext('2d').drawImage(again, 0, 0, canvas.width, canvas.height);
      again.close();
      dataUrl = canvas.toDataURL('image/jpeg', 0.62);
    }
    const result = await api('/api/auth/profile-picture', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    applyProfilePicture(result.profilePicture);
    profileBroadcast?.postMessage({ type: 'profile-picture-updated' });
    toastMessage('Profile picture updated.');
  } catch (error) {
    $('#profile-photo-error').textContent = t(error.message || 'Could not load this image. Choose another file.');
  } finally {
    editButton.disabled = false;
    editButton.textContent = '✎';
  }
});
$('#profile-logout').addEventListener('click', () => $('#logout-button').click());
const userSearchInput = $('#user-search-input');
const userSearchResults = $('#user-search-results');

function hideUserSuggestions() {
  if (!userSearchResults) return;
  userSearchResults.hidden = true;
  userSearchInput?.setAttribute('aria-expanded', 'false');
}

function showUserSearchMessage(message) {
  userSuggestions = [];
  userSearchResults.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'user-search-message';
  empty.textContent = t(message);
  userSearchResults.append(empty);
  userSearchResults.hidden = false;
  userSearchInput.setAttribute('aria-expanded', 'true');
}

function renderUserSuggestions(users) {
  userSuggestions = users;
  userSearchResults.replaceChildren();
  if (!users.length) {
    showUserSearchMessage('No matching Niti members found.');
    return;
  }
  users.forEach((user, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'user-search-result';
    button.setAttribute('role', 'option');
    button.dataset.userResult = String(index);
    const avatar = document.createElement('span');
    avatar.className = 'user-search-avatar';
    avatar.textContent = String(user.name || 'N').trim().slice(0, 1).toUpperCase();
    const details = document.createElement('span');
    details.className = 'user-search-details';
    const name = document.createElement('strong');
    name.textContent = user.name;
    const phone = document.createElement('small');
    phone.textContent = user.phoneNumber;
    details.append(name, phone);
    const email = document.createElement('small');
    email.className = 'user-search-email';
    email.textContent = user.email;
    button.append(avatar, details, email);
    userSearchResults.append(button);
  });
  userSearchResults.hidden = false;
  userSearchInput.setAttribute('aria-expanded', 'true');
}

userSearchInput.addEventListener('input', () => {
  clearTimeout(userSearchTimer);
  userSearchController?.abort();
  const digits = userSearchInput.value.replace(/\D/g, '');
  if (digits.length < 3) {
    hideUserSuggestions();
    return;
  }
  showUserSearchMessage(t('Searching Niti members…'));
  userSearchTimer = setTimeout(async () => {
    userSearchController = new AbortController();
    const query = new URLSearchParams({ mobile: userSearchInput.value });
    try {
      const result = await api(`/api/auth/users/search?${query}`, { signal: userSearchController.signal });
      renderUserSuggestions(Array.isArray(result.users) ? result.users : []);
    } catch (error) {
      if (error.name !== 'AbortError') showUserSearchMessage(error.message);
    }
  }, 250);
});

$('#user-search-submit')?.addEventListener('click', () => {
  userSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
});

userSearchResults.addEventListener('click', (event) => {
  const option = event.target.closest('[data-user-result]');
  if (!option) return;
  const user = userSuggestions[Number(option.dataset.userResult)];
  if (!user) return;
  hideUserSuggestions();
  userSearchInput.value = '';
  startNewCompose({ to: user.email });
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.user-search')) hideUserSuggestions();
});

userSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideUserSuggestions();
  if (event.key === 'Enter' && !userSearchResults.hidden) {
    const first = userSearchResults.querySelector('[data-user-result]');
    if (first) { event.preventDefault(); first.click(); }
  }
});
$('#refresh-mail').addEventListener('click', loadMessages);
$('#select-all').addEventListener('change', (event) => {
  selectedMessageIds.clear();
  if (event.target.checked) messages.forEach((message) => selectedMessageIds.add(message.id));
  renderMessages();
});
$('#delete-selected').addEventListener('click', moveSelectedToTrash);

function resetComposeForm({ to = '' } = {}) {
  $('#compose-form').reset();
  $('#draft-id').value = '';
  $('#keep-draft-attachment').value = 'false';
  $('#recipient').value = to;
  $('#attachment-name').textContent = t('Documents and media · 20 MB max');
  $('#compose-error').textContent = '';
  selectedFile = null;
}

function startNewCompose({ to = '' } = {}) {
  resetComposeForm({ to });
  showCompose();
}

function showDraft(message) {
  resetComposeForm({ to: message.draftTo || message.to || '' });
  $('#draft-id').value = message.id;
  $('#subject').value = message.subject || '';
  $('#message-body').value = message.body || '';
  if (message.hasAttachment && message.attachmentName) {
    $('#keep-draft-attachment').value = 'true';
    $('#attachment-name').textContent = message.attachmentName;
  }
  showCompose();
  $('#message-body').focus();
}

function showCompose() {
  $('#compose-error').textContent = '';
  $('#compose-backdrop').hidden = false;
  $('#recipient').focus();
}
function closeCompose() { $('#compose-backdrop').hidden = true; }
$('#compose-open').addEventListener('click', () => startNewCompose());
$('#compose-close').addEventListener('click', closeCompose);
$('#compose-backdrop').addEventListener('click', (event) => { if (event.target === $('#compose-backdrop')) closeCompose(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeCompose(); document.querySelector('.message-backdrop')?.remove(); } });
$('#attach-button').addEventListener('click', () => $('#attachment-input').click());
$('#attachment-input').addEventListener('change', () => {
  const file = $('#attachment-input').files[0];
  if (file && file.size > 20 * 1024 * 1024) {
    selectedFile = null; $('#attachment-input').value = ''; $('#attachment-name').textContent = t('File exceeds the 20 MB limit'); toastMessage(t('Choose a file smaller than 20 MB.'), true); return;
  }
  selectedFile = file || null;
  $('#keep-draft-attachment').value = 'false';
  $('#attachment-name').textContent = selectedFile ? `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(1)} MB` : t('Documents and media · 20 MB max');
});

$('#save-draft').addEventListener('click', async () => {
  composeError.textContent = '';
  const to = $('#recipient').value.trim().toLowerCase();
  const subject = $('#subject').value.trim();
  const body = $('#message-body').value.trim();
  const draftId = $('#draft-id').value;
  if (!draftId && !to && !subject && !body && !selectedFile) {
    composeError.textContent = t('Add a recipient, subject, message, or attachment before saving a draft.');
    return;
  }
  const formData = new FormData();
  formData.append('draftId', draftId);
  formData.append('to', to);
  formData.append('subject', subject);
  formData.append('body', body);
  formData.append('keepAttachment', $('#keep-draft-attachment').value);
  if (selectedFile) formData.append('attachment', selectedFile);
  const button = $('#save-draft');
  button.disabled = true;
  button.textContent = t('Saving draft…');
  try {
    await api('/api/mail/drafts', { method: 'POST', body: formData });
    closeCompose();
    resetComposeForm();
    toastMessage('Draft saved.');
    if (currentFolder === 'drafts') loadMessages();
  } catch (error) {
    composeError.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = t('Draft');
  }
});

$('#compose-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  composeError.textContent = '';
  const to = $('#recipient').value.trim().toLowerCase();
  if (!to.endsWith('@niti.com')) { composeError.textContent = t('Send messages only to registered @niti.com members.'); return; }
  if (!$('#message-body').value.trim() && !selectedFile && $('#keep-draft-attachment').value !== 'true') { composeError.textContent = t('Write a message or add an attachment before sending.'); return; }
  const formData = new FormData();
  formData.append('to', to);
  formData.append('subject', $('#subject').value.trim());
  formData.append('body', $('#message-body').value.trim());
  formData.append('draftId', $('#draft-id').value);
  if (selectedFile) formData.append('attachment', selectedFile);
  const button = $('#send-button'); button.disabled = true; button.textContent = t('Sending…');
  try {
    await api('/api/mail/messages', { method: 'POST', body: formData });
    closeCompose(); resetComposeForm();
    toastMessage(t('Message delivered to the Niti member.'));
    if (currentFolder === 'sent' || currentFolder === 'drafts') loadMessages();
  } catch (error) { composeError.textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = `${t('Send message')} <b>→</b>`; }
});

$('#account-button').addEventListener('click', () => { $('#account-menu').hidden = !$('#account-menu').hidden; });
$('#logout-button').addEventListener('click', async () => {
  $('#login-form').reset();
  $('#login-password').value = '';
  $('#login-password').type = 'password';
  $('#login-password').parentElement.querySelector('.show-password').textContent = t('Show');
  $('#otp-code').value = '';
  $('#new-password').value = '';
  $('#confirm-password').value = '';
  $('#account-menu').hidden = true;
  showLogin();
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* The login form is cleared even if the session has expired. */ }
});
$('#mobile-sidebar-toggle').addEventListener('click', () => $('#mail-sidebar').classList.toggle('open'));
document.addEventListener('click', (event) => {
  if (!$('#mail-sidebar').contains(event.target) && event.target !== $('#mobile-sidebar-toggle')) $('#mail-sidebar').classList.remove('open');
  if (!$('#account-button').contains(event.target) && !$('#account-menu').contains(event.target)) $('#account-menu').hidden = true;
});

document.querySelectorAll('[data-language]').forEach((button) => {
  button.addEventListener('click', () => {
    const selectedLanguage = button.dataset.language;
    i18n.setLanguage(selectedLanguage);
    try { localStorage.setItem('niti-language', selectedLanguage); } catch { /* Keep this choice for the current tab if storage is disabled. */ }
    languageView.hidden = true;
    authView.hidden = false;
    boot();
  });
});

let savedLanguage = null;
try { savedLanguage = localStorage.getItem('niti-language'); } catch { /* Show the language picker when browser storage is unavailable. */ }
if (savedLanguage && Object.hasOwn(i18n.locales, savedLanguage)) {
  i18n.setLanguage(savedLanguage);
  languageView.hidden = true;
  authView.hidden = false;
  boot().finally(async () => {
    finishOpeningSplash();
    let returnToProfile = false;
    try {
      returnToProfile = sessionStorage.getItem('niti-return-to-profile') === '1';
      sessionStorage.removeItem('niti-return-to-profile');
    } catch { /* Keep the app available when session storage is disabled. */ }
    if (returnToProfile) await showProfilePage(false);
  });
} else {
  languageView.hidden = false;
  authView.hidden = true;
  finishOpeningSplash();
}

const profileLanguage = $('#profile-language');
if (profileLanguage) {
  profileLanguage.value = i18n.language;
  profileLanguage.addEventListener('change', () => {
    const selectedLanguage = profileLanguage.value;
    try {
      localStorage.setItem('niti-language', selectedLanguage);
      if (currentPage === 'profile') sessionStorage.setItem('niti-return-to-profile', '1');
    } catch { /* Continue with this tab's selected language if storage is disabled. */ }
    window.location.reload();
  });
}

$('#theme-toggle').addEventListener('click', (event) => {
  const isDark = document.body.classList.toggle('dark-theme');
  const label = t(isDark ? 'Light mode' : 'Dark mode');
  event.currentTarget.querySelector('span').textContent = isDark ? '☼' : '☾';
  event.currentTarget.querySelector('b').textContent = label;
  event.currentTarget.setAttribute('aria-label', label);
  event.currentTarget.title = label;
});
