// ─── 토큰 관리 ───
function getToken() { return localStorage.getItem('token'); }
function setToken(token) { localStorage.setItem('token', token); }
function clearToken() { localStorage.removeItem('token'); localStorage.removeItem('user'); }
function getUser() { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } }
function setUser(user) { localStorage.setItem('user', JSON.stringify(user)); }

// ─── API 헬퍼 ───
async function api(url, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) { clearToken(); showLogin(); throw new Error('인증 만료'); }
  if (res.status === 403) {
    const data = await res.json();
    if (data.expired) { showExpired(); throw new Error('체험 만료'); }
  }
  return res;
}

// ─── 페이지 전환 ───
function showLogin() {
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('main-page').classList.add('hidden');
  document.getElementById('expired-page').classList.add('hidden');
}

function showMain() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('main-page').classList.remove('hidden');
  document.getElementById('expired-page').classList.add('hidden');

  const user = getUser();
  if (user) {
    document.getElementById('user-name').textContent = user.name || user.email;
    updateTrialBar(user);
  }

  loadStats();
  loadRecentMessages();
  loadPhoneStatus();
}

function showExpired() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('main-page').classList.add('hidden');
  document.getElementById('expired-page').classList.remove('hidden');
}

function updateTrialBar(user) {
  const bar = document.getElementById('trial-bar');
  const text = document.getElementById('trial-text');
  if (!user.trial_expires_at) return;

  const expires = new Date(user.trial_expires_at);
  const now = new Date();
  const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));

  if (daysLeft <= 0) {
    bar.className = 'trial-bar expired';
    text.textContent = '무료 체험 기간이 만료되었습니다';
  } else if (daysLeft <= 3) {
    bar.className = 'trial-bar warning';
    text.textContent = `무료 체험 ${daysLeft}일 남음`;
  } else {
    bar.className = 'trial-bar';
    text.textContent = `무료 체험 ${daysLeft}일 남음`;
  }
}

// ─── 로그인 초기화 확인 ───
async function checkAuth() {
  const token = getToken();
  if (!token) { showLogin(); return; }

  try {
    const res = await fetch('/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const user = await res.json();
      setUser(user);
      if (user.trial_active) {
        showMain();
      } else {
        showExpired();
      }
    } else if (res.status === 401) {
      clearToken();
      showLogin();
    } else {
      // 서버 오류 시 토큰 유지하고 메인 표시 시도
      const user = getUser();
      if (user) { showMain(); } else { showLogin(); }
    }
  } catch {
    // 네트워크 오류 시 토큰 삭제하지 않음
    const user = getUser();
    if (user) { showMain(); } else { showLogin(); }
  }
}

// ─── WebView 감지 ───
function isWebView() {
  const ua = navigator.userAgent || '';
  return /KAKAOTALK|NAVER|Instagram|FB|Line|wv/i.test(ua);
}
if (isWebView()) {
  const warn = document.getElementById('webview-warning');
  if (warn) warn.style.display = 'block';
}

// ─── 소셜 로그인 (서버에서 처리) ───
function loginGoogle() {
  window.location.href = '/auth/google/start?redirect=web';
}

function loginKakao() {
  window.location.href = '/auth/kakao/start?redirect=web';
}

function loginNaver() {
  window.location.href = '/auth/naver/start?redirect=web';
}

// 소셜 로그인 콜백 처리 (팝업/리다이렉트에서 호출)
window.handleAuthCallback = async function(provider, tokenData) {
  try {
    const res = await fetch(`/auth/${provider}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokenData)
    });
    const data = await res.json();

    if (data.success) {
      setToken(data.token);
      setUser(data.user);
      showMain();
    } else {
      alert('로그인 실패: ' + (data.error || '알 수 없는 오류'));
    }
  } catch (err) {
    alert('로그인 처리 중 오류가 발생했습니다.');
  }
};

function logout() {
  clearToken();
  showLogin();
}

// ─── 탭 전환 ───
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');

    if (tab.dataset.tab === 'history') loadMessages();
    if (tab.dataset.tab === 'settings') loadSettings();
  });
});

// ─── 주문 등록 (앱에서만 사용, 웹에서는 비활성) ───

// ─── 설정 저장 ───
document.getElementById('save-settings').addEventListener('click', async () => {
  const template = document.getElementById('template-input').value;
  const delay = document.getElementById('delay-input').value;
  const result = document.getElementById('settings-result');

  try {
    const res = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ message_template: template, delay_minutes: parseInt(delay) })
    });
    const data = await res.json();
    result.className = data.success ? 'result success' : 'result error';
    result.textContent = data.success ? '설정이 저장되었습니다' : '저장 실패';
  } catch {
    result.className = 'result error';
    result.textContent = '서버 연결 실패';
  }
  result.classList.remove('hidden');
  setTimeout(() => result.classList.add('hidden'), 2000);
});

// ─── 데이터 로드 함수들 ───
async function loadStats() {
  try {
    const res = await api('/api/stats');
    const stats = await res.json();
    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-pending').textContent = stats.pending;
    document.getElementById('stat-sent').textContent = stats.sent;
    document.getElementById('stat-failed').textContent = stats.failed;
  } catch {}
}

async function loadRecentMessages() {
  try {
    const res = await api('/api/messages?limit=5');
    const messages = await res.json();
    renderMessageList('recent-list', messages);
  } catch {}
}

async function loadMessages() {
  try {
    const res = await api('/api/messages?limit=50');
    const messages = await res.json();
    renderMessageList('history-list', messages);
  } catch {}
}

async function loadSettings() {
  try {
    const res = await api('/api/settings');
    const settings = await res.json();
    document.getElementById('template-input').value = settings.message_template || '';
    document.getElementById('delay-input').value = settings.delay_minutes || 120;
  } catch {}
}

async function loadPhoneStatus() {
  try {
    const res = await api('/api/phone/status');
    const status = await res.json();
    const dot = document.querySelector('.status-dot');
    const text = document.getElementById('phone-status-text');
    if (status.connected) {
      dot.className = 'status-dot connected';
      text.textContent = '핸드폰 앱 연결됨';
    } else {
      dot.className = 'status-dot disconnected';
      text.textContent = '핸드폰 앱 연결 대기중...';
    }
  } catch {}
}

function renderMessageList(containerId, messages) {
  const container = document.getElementById(containerId);
  if (!messages.length) {
    container.innerHTML = '<p class="empty">내역이 없습니다</p>';
    return;
  }
  container.innerHTML = messages.map(msg => {
    let statusClass, statusText;
    if (msg.sent === 1) { statusClass = 'status-sent'; statusText = '발송완료'; }
    else if (msg.sent === -1) { statusClass = 'status-failed'; statusText = '실패'; }
    else { statusClass = 'status-pending'; statusText = '대기중'; }
    const cancelBtn = msg.sent === 0
      ? `<button class="btn-cancel" onclick="cancelMessage(${msg.id})" title="취소">&times;</button>` : '';
    return `<div class="msg-item">
      <div class="msg-info"><div class="msg-phone">${formatPhone(msg.phone)}</div><div class="msg-time">예약: ${formatTime(msg.scheduled_at)}</div></div>
      <span class="msg-status ${statusClass}">${statusText}</span>${cancelBtn}</div>`;
  }).join('');
}

async function cancelMessage(id) {
  if (!confirm('이 예약을 취소할까요?')) return;
  try {
    await api(`/api/messages/${id}`, { method: 'DELETE' });
    loadStats(); loadRecentMessages(); loadMessages();
  } catch {}
}

function formatPhone(phone) {
  if (phone.startsWith('050')) return phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  if (phone.length === 11) return phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  return phone;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.replace(' ', 'T'));
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  const hour = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return `${ampm} ${hour}:${m}`;
}

// ─── 초기화 ───
checkAuth();

setInterval(() => {
  if (getToken()) { loadStats(); }
}, 30000);
