require('dotenv').config();
const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const {
  db, findOrCreateUser, getUserById, isTrialActive,
  scheduleMessage, markSent, markFailed,
  getPendingMessages, getMessages, deleteMessage,
  getUserSetting, setUserSetting, getSetting, setSetting, getTodayStats
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'reviewjipsa-secret-key-change-this';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════
//  JWT 토큰 생성/검증
// ═══════════════════════════════════════

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '로그인이 필요합니다' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.id);
    if (!user) return res.status(401).json({ error: '사용자를 찾을 수 없습니다' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: '토큰이 만료되었습니다. 다시 로그인해주세요' });
  }
}

function trialMiddleware(req, res, next) {
  if (!isTrialActive(req.user)) {
    return res.status(403).json({ error: '무료 체험 기간이 만료되었습니다', expired: true });
  }
  next();
}

// ═══════════════════════════════════════
//  소셜 로그인 API
// ═══════════════════════════════════════

// 구글 로그인 콜백
app.post('/auth/google', async (req, res) => {
  try {
    const { token: googleToken } = req.body;
    // 구글 토큰 검증
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${googleToken}`);
    const data = await response.json();

    if (!data.email) return res.status(400).json({ error: '구글 인증 실패' });

    const user = findOrCreateUser(data.email, data.name || data.email, 'google', data.sub);
    const jwtToken = generateToken(user);

    res.json({
      success: true,
      token: jwtToken,
      user: { id: user.id, email: user.email, name: user.name, trial_expires_at: user.trial_expires_at }
    });
  } catch (err) {
    res.status(500).json({ error: '로그인 처리 중 오류' });
  }
});

// 카카오 로그인 콜백
app.post('/auth/kakao', async (req, res) => {
  try {
    const { access_token } = req.body;
    const response = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const data = await response.json();

    const email = data.kakao_account?.email || `kakao_${data.id}@kakao.com`;
    const name = data.kakao_account?.profile?.nickname || '카카오 사용자';

    const user = findOrCreateUser(email, name, 'kakao', String(data.id));
    const jwtToken = generateToken(user);

    res.json({
      success: true,
      token: jwtToken,
      user: { id: user.id, email: user.email, name: user.name, trial_expires_at: user.trial_expires_at }
    });
  } catch (err) {
    res.status(500).json({ error: '카카오 로그인 실패' });
  }
});

// 네이버 로그인 콜백
app.post('/auth/naver', async (req, res) => {
  try {
    const { access_token } = req.body;
    const response = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const data = await response.json();

    if (data.resultcode !== '00') return res.status(400).json({ error: '네이버 인증 실패' });

    const email = data.response.email || `naver_${data.response.id}@naver.com`;
    const name = data.response.name || data.response.nickname || '네이버 사용자';

    const user = findOrCreateUser(email, name, 'naver', data.response.id);
    const jwtToken = generateToken(user);

    res.json({
      success: true,
      token: jwtToken,
      user: { id: user.id, email: user.email, name: user.name, trial_expires_at: user.trial_expires_at }
    });
  } catch (err) {
    res.status(500).json({ error: '네이버 로그인 실패' });
  }
});

// 간편 로그인 (이메일로 자동 가입/로그인 — 앱용)
app.post('/auth/simple', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요' });

  const user = findOrCreateUser(email, email.split('@')[0], 'email', email);
  const jwtToken = generateToken(user);

  res.json({
    success: true,
    token: jwtToken,
    user: { id: user.id, email: user.email, name: user.name, trial_expires_at: user.trial_expires_at }
  });
});

// ═══════════════════════════════════════
//  소셜 로그인 (앱에서 브라우저로 열기)
// ═══════════════════════════════════════

// 로그인 성공 후 리다이렉트 헬퍼
function loginRedirect(req, res, user, jwtToken, stateParam) {
  // state가 'web'이거나, 브라우저 User-Agent면 웹으로 처리
  const isWeb = stateParam === 'web' ||
    (!stateParam && req.headers['user-agent'] && !req.headers['user-agent'].includes('okhttp'));

  if (isWeb) {
    res.redirect(`/auth/success?token=${jwtToken}&name=${encodeURIComponent(user.name)}&email=${encodeURIComponent(user.email)}`);
  } else {
    res.redirect(`reviewjipsa://auth/auth/app/callback?token=${jwtToken}&name=${encodeURIComponent(user.name)}&email=${encodeURIComponent(user.email)}`);
  }
}

// 로그인 성공 페이지 (웹용)
app.get('/auth/success', (req, res) => {
  const { token, name, email } = req.query;
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>로그인 성공</title>
    <style>body{display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;background:#f5f5f5;margin:0;}
    .box{text-align:center;}.spinner{width:40px;height:40px;border:4px solid #ddd;border-top:4px solid #2d6a4f;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px;}
    @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></head><body>
    <div class="box"><div class="spinner"></div><p>로그인 중...</p></div>
    <script>
      try {
        localStorage.setItem('token','${token}');
        localStorage.setItem('user', JSON.stringify({name:decodeURIComponent('${encodeURIComponent(name||'')}'),email:decodeURIComponent('${encodeURIComponent(email||'')}')}));
        setTimeout(function(){ window.location.replace('/'); }, 500);
      } catch(e) {
        document.body.innerHTML = '<p>로그인 처리 중 오류: '+e.message+'</p><a href="/">다시 시도</a>';
      }
    </script></body></html>`);
});

// 구글 로그인
app.get('/auth/google/start', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.send('구글 로그인 설정이 필요합니다.');
  const redirect = req.query.redirect || 'app';
  const redirectUri = encodeURIComponent('https://kkorichire-sms.onrender.com/auth/google/app-callback');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=email%20profile&state=${redirect}`;
  res.redirect(url);
});

app.get('/auth/google/app-callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `code=${code}&client_id=${process.env.GOOGLE_CLIENT_ID}&client_secret=${process.env.GOOGLE_CLIENT_SECRET}&redirect_uri=https://kkorichire-sms.onrender.com/auth/google/app-callback&grant_type=authorization_code`
    });
    const tokenData = await tokenRes.json();
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();
    const user = findOrCreateUser(userData.email, userData.name || userData.email, 'google', userData.id);
    const jwtToken = generateToken(user);
    loginRedirect(req, res, user, jwtToken, state);
  } catch (err) {
    res.send('구글 로그인 실패: ' + err.message);
  }
});

// 카카오 로그인
app.get('/auth/kakao/start', (req, res) => {
  const clientId = process.env.KAKAO_CLIENT_ID;
  if (!clientId) return res.send('카카오 로그인 설정이 필요합니다.');
  const redirect = req.query.redirect || 'app';
  const redirectUri = encodeURIComponent('https://kkorichire-sms.onrender.com/auth/kakao/app-callback');
  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${redirect}`;
  res.redirect(url);
});

app.get('/auth/kakao/app-callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=authorization_code&client_id=${process.env.KAKAO_CLIENT_ID}&redirect_uri=https://kkorichire-sms.onrender.com/auth/kakao/app-callback&code=${code}`
    });
    const tokenData = await tokenRes.json();
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();
    const email = userData.kakao_account?.email || `kakao_${userData.id}@kakao.com`;
    const name = userData.kakao_account?.profile?.nickname || '카카오 사용자';
    const user = findOrCreateUser(email, name, 'kakao', String(userData.id));
    const jwtToken = generateToken(user);
    loginRedirect(req, res, user, jwtToken, state);
  } catch (err) {
    res.send('카카오 로그인 실패: ' + err.message);
  }
});

// 네이버 로그인
app.get('/auth/naver/start', (req, res) => {
  const clientId = process.env.NAVER_CLIENT_ID;
  if (!clientId) return res.send('네이버 로그인 설정이 필요합니다.');
  const redirect = req.query.redirect || 'app';
  const stateData = redirect; // state에 redirect 정보 전달
  const redirectUri = encodeURIComponent('https://kkorichire-sms.onrender.com/auth/naver/app-callback');
  const url = `https://nid.naver.com/oauth2.0/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${stateData}`;
  res.redirect(url);
});

app.get('/auth/naver/app-callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const tokenRes = await fetch(`https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=${process.env.NAVER_CLIENT_ID}&client_secret=${process.env.NAVER_CLIENT_SECRET}&code=${code}&state=${state}`);
    const tokenData = await tokenRes.json();
    const userRes = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();
    const email = userData.response.email || `naver_${userData.response.id}@naver.com`;
    const name = userData.response.name || userData.response.nickname || '네이버 사용자';
    const user = findOrCreateUser(email, name, 'naver', userData.response.id);
    const jwtToken = generateToken(user);
    loginRedirect(req, res, user, jwtToken, state);
  } catch (err) {
    res.send('네이버 로그인 실패: ' + err.message);
  }
});

// 토큰으로 내 정보 조회
app.get('/auth/me', authMiddleware, (req, res) => {
  const user = req.user;
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    provider: user.provider,
    trial_expires_at: user.trial_expires_at,
    trial_active: isTrialActive(user)
  });
});

// ═══════════════════════════════════════
//  인증 필요 API
// ═══════════════════════════════════════

// 주문 접수
app.post('/api/order', authMiddleware, trialMiddleware, (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: '전화번호를 입력해주세요' });

  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const template = getUserSetting(req.user.id, 'message_template') || '감사합니다! 리뷰 부탁드립니다.';
  const delayMinutes = parseInt(getUserSetting(req.user.id, 'delay_minutes') || '120', 10);

  const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);
  const scheduledAtStr = scheduledAt.toISOString().replace('T', ' ').slice(0, 19);

  const result = scheduleMessage(req.user.id, cleanPhone, template, scheduledAtStr);
  console.log(`[예약] user:${req.user.id} ${cleanPhone} → ${scheduledAtStr}`);

  res.json({
    success: true,
    id: result.lastInsertRowid,
    phone: cleanPhone,
    scheduled_at: scheduledAtStr
  });
});

// 메시지 목록
app.get('/api/messages', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  res.json(getMessages(req.user.id, limit, offset));
});

// 예약 취소
app.delete('/api/messages/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = deleteMessage(id, req.user.id);
  if (result.changes > 0) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: '취소할 수 없는 메시지입니다' });
  }
});

// 설정 조회
app.get('/api/settings', authMiddleware, (req, res) => {
  res.json({
    message_template: getUserSetting(req.user.id, 'message_template'),
    delay_minutes: getUserSetting(req.user.id, 'delay_minutes') || '120'
  });
});

// 설정 저장
app.put('/api/settings', authMiddleware, (req, res) => {
  const { message_template, delay_minutes } = req.body;
  if (message_template !== undefined) setUserSetting(req.user.id, 'message_template', message_template);
  if (delay_minutes !== undefined) setUserSetting(req.user.id, 'delay_minutes', String(delay_minutes));
  res.json({ success: true });
});

// 통계
app.get('/api/stats', authMiddleware, (req, res) => {
  res.json(getTodayStats(req.user.id));
});

// ═══════════════════════════════════════
//  핸드폰 앱용 API (토큰 인증)
// ═══════════════════════════════════════

app.get('/api/phone/pending', authMiddleware, trialMiddleware, (req, res) => {
  // 해당 사용자의 대기 메시지만 반환
  const messages = db.prepare(
    "SELECT * FROM messages WHERE user_id = ? AND sent = 0 AND scheduled_at <= datetime('now', 'localtime')"
  ).all(req.user.id);
  res.json(messages);
});

app.post('/api/phone/report', authMiddleware, (req, res) => {
  const { id, success, error } = req.body;
  if (!id) return res.status(400).json({ error: 'id 필요' });

  if (success) {
    markSent(id);
    console.log(`[발송 완료] #${id} (핸드폰)`);
  } else {
    markFailed(id, error || '발송 실패');
    console.log(`[발송 실패] #${id}: ${error}`);
  }
  res.json({ success: true });
});

let lastPhoneHeartbeat = {};

app.post('/api/phone/heartbeat', authMiddleware, (req, res) => {
  lastPhoneHeartbeat[req.user.id] = new Date();
  res.json({ success: true });
});

app.get('/api/phone/status', authMiddleware, (req, res) => {
  const lastSeen = lastPhoneHeartbeat[req.user.id];
  const connected = lastSeen && (Date.now() - lastSeen.getTime()) < 2 * 60 * 1000;
  res.json({ connected, last_seen: lastSeen ? lastSeen.toISOString() : null });
});

// ═══════════════════════════════════════
//  OAuth 설정 정보 제공 (앱/웹에서 사용)
// ═══════════════════════════════════════

app.get('/auth/config', (req, res) => {
  res.json({
    google_client_id: process.env.GOOGLE_CLIENT_ID || '',
    kakao_client_id: process.env.KAKAO_CLIENT_ID || '',
    naver_client_id: process.env.NAVER_CLIENT_ID || ''
  });
});

// ═══════════════════════════════════════
//  관리자 API
// ═══════════════════════════════════════

const ADMIN_KEY = process.env.ADMIN_KEY || 'reviewjipsa-admin-2026';

function adminMiddleware(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: '관리자 권한이 없습니다' });
  }
  next();
}

// 전체 사용자 목록
app.get('/admin/users', adminMiddleware, (req, res) => {
  const users = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM messages WHERE user_id = u.id) as total_messages,
      (SELECT COUNT(*) FROM messages WHERE user_id = u.id AND sent = 1) as sent_messages
    FROM users u ORDER BY u.created_at DESC
  `).all();
  res.json(users);
});

// 사용자 무료 체험 기간 연장
app.post('/admin/users/:id/extend', adminMiddleware, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { days } = req.body;
  if (!days) return res.status(400).json({ error: 'days 필요' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });

  // 현재 만료일 기준 또는 오늘 기준으로 연장
  const baseDate = new Date(user.trial_expires_at) > new Date()
    ? new Date(user.trial_expires_at)
    : new Date();
  const newExpiry = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
  const newExpiryStr = newExpiry.toISOString().replace('T', ' ').slice(0, 19);

  db.prepare('UPDATE users SET trial_expires_at = ? WHERE id = ?').run(newExpiryStr, userId);

  res.json({ success: true, trial_expires_at: newExpiryStr });
});

// 사용자 삭제
app.delete('/admin/users/:id', adminMiddleware, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM messages WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.json({ success: true });
});

// 전체 통계
app.get('/admin/stats', adminMiddleware, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const activeUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE trial_expires_at > datetime('now','localtime')").get();
  const expiredUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE trial_expires_at <= datetime('now','localtime')").get();
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get();
  const sentMessages = db.prepare('SELECT COUNT(*) as count FROM messages WHERE sent = 1').get();
  res.json({
    total_users: totalUsers.count,
    active_users: activeUsers.count,
    expired_users: expiredUsers.count,
    total_messages: totalMessages.count,
    sent_messages: sentMessages.count
  });
});

// 관리자 페이지 서빙
app.get('/admin', adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── 서버 시작 ───
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   리뷰집사 - 자동 문자 발송 시스템   ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log('║   소셜 로그인 + 15일 무료 체험       ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
});
