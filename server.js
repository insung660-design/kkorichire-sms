require('dotenv').config();
const express = require('express');
const path = require('path');
const {
  db, scheduleMessage, markSent, markFailed,
  getPendingMessages, getMessages, deleteMessage,
  getSetting, setSetting, getTodayStats
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API: 주문 접수 (문자 예약) ───
app.post('/api/order', (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: '전화번호를 입력해주세요' });
  }

  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const template = getSetting('message_template') || '감사합니다!';
  const delayMinutes = parseInt(getSetting('delay_minutes') || '120', 10);

  const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);
  const scheduledAtStr = scheduledAt.toISOString().replace('T', ' ').slice(0, 19);

  const result = scheduleMessage(cleanPhone, template, scheduledAtStr);

  console.log(`[예약] ${cleanPhone} → ${scheduledAtStr} (${delayMinutes}분 후)`);

  res.json({
    success: true,
    id: result.lastInsertRowid,
    phone: cleanPhone,
    scheduled_at: scheduledAtStr
  });
});

// ─── API: 메시지 목록 ───
app.get('/api/messages', (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  res.json(getMessages(limit, offset));
});

// ─── API: 예약 취소 ───
app.delete('/api/messages/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = deleteMessage(id);
  if (result.changes > 0) {
    console.log(`[취소] 메시지 #${id}`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: '취소할 수 없는 메시지입니다' });
  }
});

// ─── API: 설정 ───
app.get('/api/settings', (req, res) => {
  res.json({
    message_template: getSetting('message_template'),
    delay_minutes: getSetting('delay_minutes')
  });
});

app.put('/api/settings', (req, res) => {
  const { message_template, delay_minutes } = req.body;
  if (message_template !== undefined) setSetting('message_template', message_template);
  if (delay_minutes !== undefined) setSetting('delay_minutes', String(delay_minutes));
  res.json({ success: true });
});

// ─── API: 통계 ───
app.get('/api/stats', (req, res) => {
  res.json(getTodayStats());
});

// ═══════════════════════════════════════
//  핸드폰 앱용 API
// ═══════════════════════════════════════

// 핸드폰 앱이 발송할 메시지 가져가기
// → 예약 시간이 지난 미발송 메시지 반환
app.get('/api/phone/pending', (req, res) => {
  const messages = getPendingMessages();
  console.log(`[앱 조회] 대기 메시지 ${messages.length}건`);
  res.json(messages);
});

// 핸드폰 앱이 발송 결과 보고
app.post('/api/phone/report', (req, res) => {
  const { id, success, error } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'id 필요' });
  }

  if (success) {
    markSent(id);
    console.log(`[발송 완료] #${id} (핸드폰)`);
  } else {
    markFailed(id, error || '발송 실패');
    console.log(`[발송 실패] #${id}: ${error}`);
  }

  res.json({ success: true });
});

// 핸드폰 앱 연결 상태 확인 (heartbeat)
let lastPhoneHeartbeat = null;

app.post('/api/phone/heartbeat', (req, res) => {
  lastPhoneHeartbeat = new Date();
  console.log(`[앱 연결] ${lastPhoneHeartbeat.toLocaleTimeString()}`);
  res.json({ success: true });
});

app.get('/api/phone/status', (req, res) => {
  const connected = lastPhoneHeartbeat &&
    (Date.now() - lastPhoneHeartbeat.getTime()) < 2 * 60 * 1000; // 2분 이내
  res.json({
    connected,
    last_seen: lastPhoneHeartbeat ? lastPhoneHeartbeat.toISOString() : null
  });
});

// ─── 서버 시작 ───
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   꼬리치레 자동 문자 발송 시스템     ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log('║   문자 발송: 핸드폰 앱 연동 방식     ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  console.log('핸드폰 앱을 실행하면 자동으로 문자가 발송됩니다.\n');
});
