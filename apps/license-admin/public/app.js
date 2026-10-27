const $ = selector => document.querySelector(selector);
const loginView = $('#login-view');
const dashboardView = $('#dashboard-view');
const connectionStatus = $('#connection-status');
let csrfToken = null;

function showMessage(element, message, kind = '') {
  element.textContent = message;
  element.className = `message${kind ? ` ${kind}` : ''}`;
}

async function api(path, { method = 'GET', body, csrf = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store'
  });
  let result = {};
  try { result = await response.json(); } catch { /* The UI only needs the status when a response is not JSON. */ }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/session') setSignedIn(false);
    throw new Error(result.error || `Yêu cầu thất bại (${response.status}).`);
  }
  return result;
}

function setSignedIn(signedIn) {
  loginView.hidden = signedIn;
  dashboardView.hidden = !signedIn;
  const dot = document.createElement('span');
  dot.className = 'dot';
  if (signedIn) dot.classList.add('connected');
  connectionStatus.replaceChildren(dot, document.createTextNode(signedIn ? 'Phiên quản trị an toàn' : 'Chưa đăng nhập'));
  if (!signedIn) csrfToken = null;
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const message = $('#login-message');
  button.disabled = true;
  showMessage(message, 'Đang xác thực…');
  try {
    const password = $('#admin-password').value;
    const result = await api('/api/session', { method: 'POST', body: { password } });
    csrfToken = result.csrfToken;
    $('#admin-password').value = '';
    setSignedIn(true);
    showMessage(message, '');
  } catch (error) {
    showMessage(message, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#logout-button').addEventListener('click', async () => {
  try { await api('/api/session', { method: 'DELETE', csrf: true }); } catch { /* Expired sessions are cleared locally below. */ }
  setSignedIn(false);
  $('#admin-password').focus();
});

$('#machine-code').addEventListener('input', event => {
  event.currentTarget.value = event.currentTarget.value.toUpperCase();
});

$('#license-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#issue-button');
  const message = $('#license-message');
  const resultPanel = $('#license-result');
  button.disabled = true;
  resultPanel.hidden = true;
  showMessage(message, 'Đang ký license trên server…');
  try {
    const body = {
      machineCode: $('#machine-code').value.trim(),
      licenseId: $('#license-id').value.trim()
    };
    const result = await api('/api/issue-license', { method: 'POST', body, csrf: true });
    $('#license-result-id').textContent = result.licenseId;
    $('#license-token').value = result.licenseToken;
    resultPanel.hidden = false;
    showMessage(message, 'Đã tạo license. Sao chép token và gửi cho khách qua kênh riêng.', 'success');
  } catch (error) {
    showMessage(message, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#copy-button').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#license-token').value);
    $('#copy-button').textContent = 'Đã sao chép';
    window.setTimeout(() => { $('#copy-button').textContent = 'Sao chép'; }, 1800);
  } catch {
    $('#license-token').focus();
    $('#license-token').select();
    showMessage($('#license-message'), 'Không truy cập được clipboard. Token đã được chọn để bạn copy.', 'error');
  }
});

async function initialize() {
  try {
    const session = await api('/api/session');
    csrfToken = session.csrfToken ?? null;
    setSignedIn(session.authenticated === true);
    if (!session.authenticated) $('#admin-password').focus();
  } catch (error) {
    setSignedIn(false);
    showMessage($('#login-message'), error.message, 'error');
  }
}

initialize();
