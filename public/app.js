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

// ─── 주문 등록 ───
document.getElementById('order-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phoneInput = document.getElementById('phone-input');
  const result = document.getElementById('register-result');
  const phone = phoneInput.value.trim();

  if (!phone) return;

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();

    if (data.success) {
      result.className = 'result success';
      result.textContent = `${data.phone} 예약 완료! (${formatTime(data.scheduled_at)} 발송)`;
      result.classList.remove('hidden');
      phoneInput.value = '';
      phoneInput.focus();
      loadStats();
      loadRecentMessages();
    } else {
      result.className = 'result error';
      result.textContent = data.error;
      result.classList.remove('hidden');
    }
  } catch (err) {
    result.className = 'result error';
    result.textContent = '서버 연결 실패';
    result.classList.remove('hidden');
  }

  setTimeout(() => result.classList.add('hidden'), 3000);
});

// ─── 설정 저장 ───
document.getElementById('save-settings').addEventListener('click', async () => {
  const template = document.getElementById('template-input').value;
  const delay = document.getElementById('delay-input').value;
  const result = document.getElementById('settings-result');

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_template: template, delay_minutes: parseInt(delay) })
    });
    const data = await res.json();

    if (data.success) {
      result.className = 'result success';
      result.textContent = '설정이 저장되었습니다';
    } else {
      result.className = 'result error';
      result.textContent = '저장 실패';
    }
  } catch {
    result.className = 'result error';
    result.textContent = '서버 연결 실패';
  }

  result.classList.remove('hidden');
  setTimeout(() => result.classList.add('hidden'), 2000);
});

// ─── 통계 로드 ───
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-pending').textContent = stats.pending;
    document.getElementById('stat-sent').textContent = stats.sent;
    document.getElementById('stat-failed').textContent = stats.failed;
  } catch {}
}

// ─── 최근 등록 메시지 ───
async function loadRecentMessages() {
  try {
    const res = await fetch('/api/messages?limit=5');
    const messages = await res.json();
    renderMessageList('recent-list', messages);
  } catch {}
}

// ─── 전체 메시지 내역 ───
async function loadMessages() {
  try {
    const res = await fetch('/api/messages?limit=50');
    const messages = await res.json();
    renderMessageList('history-list', messages);
  } catch {}
}

// ─── 설정 로드 ───
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    document.getElementById('template-input').value = settings.message_template || '';
    document.getElementById('delay-input').value = settings.delay_minutes || 120;
  } catch {}
}

// ─── 메시지 리스트 렌더링 ───
function renderMessageList(containerId, messages) {
  const container = document.getElementById(containerId);

  if (!messages.length) {
    container.innerHTML = '<p class="empty">내역이 없습니다</p>';
    return;
  }

  container.innerHTML = messages.map(msg => {
    let statusClass, statusText;
    if (msg.sent === 1) {
      statusClass = 'status-sent';
      statusText = '발송완료';
    } else if (msg.sent === -1) {
      statusClass = 'status-failed';
      statusText = '실패';
    } else {
      statusClass = 'status-pending';
      statusText = '대기중';
    }

    const cancelBtn = msg.sent === 0
      ? `<button class="btn-cancel" onclick="cancelMessage(${msg.id})" title="취소">&times;</button>`
      : '';

    return `
      <div class="msg-item">
        <div class="msg-info">
          <div class="msg-phone">${formatPhone(msg.phone)}</div>
          <div class="msg-time">예약: ${formatTime(msg.scheduled_at)}</div>
        </div>
        <span class="msg-status ${statusClass}">${statusText}</span>
        ${cancelBtn}
      </div>
    `;
  }).join('');
}

// ─── 예약 취소 ───
async function cancelMessage(id) {
  if (!confirm('이 예약을 취소할까요?')) return;

  try {
    const res = await fetch(`/api/messages/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadStats();
      loadRecentMessages();
      loadMessages();
    }
  } catch {}
}

// ─── 유틸: 전화번호 포맷 ───
function formatPhone(phone) {
  if (phone.startsWith('050')) {
    return phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  if (phone.length === 11) {
    return phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  return phone;
}

// ─── 유틸: 시간 포맷 ───
function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.replace(' ', 'T'));
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  const hour = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return `${ampm} ${hour}:${m}`;
}

// ─── 핸드폰 연결 상태 확인 ───
async function loadPhoneStatus() {
  try {
    const res = await fetch('/api/phone/status');
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

// ─── 초기 로드 ───
loadStats();
loadRecentMessages();
loadPhoneStatus();

// 30초마다 갱신
setInterval(() => {
  loadStats();
  loadPhoneStatus();
}, 30000);
