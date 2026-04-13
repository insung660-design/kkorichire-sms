const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    message TEXT NOT NULL,
    order_source TEXT DEFAULT '배달의민족',
    scheduled_at TEXT NOT NULL,
    sent INTEGER DEFAULT 0,
    sent_at TEXT,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// 기본 문자 템플릿 설정
const defaultTemplate = db.prepare('SELECT value FROM settings WHERE key = ?').get('message_template');
if (!defaultTemplate) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    'message_template',
    '안녕하세요, 꼬리치레입니다 🙏\n맛있게 드셨나요?\n소중한 리뷰 한 줄 부탁드립니다!\n감사합니다 😊'
  );
}

const defaultDelay = db.prepare('SELECT value FROM settings WHERE key = ?').get('delay_minutes');
if (!defaultDelay) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('delay_minutes', '120');
}

module.exports = {
  db,

  // 메시지 예약
  scheduleMessage(phone, message, scheduledAt) {
    const stmt = db.prepare(
      'INSERT INTO messages (phone, message, scheduled_at) VALUES (?, ?, ?)'
    );
    return stmt.run(phone, message, scheduledAt);
  },

  // 발송 완료 처리
  markSent(id) {
    db.prepare(
      "UPDATE messages SET sent = 1, sent_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(id);
  },

  // 발송 실패 처리
  markFailed(id, error) {
    db.prepare(
      "UPDATE messages SET sent = -1, error = ?, sent_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(error, id);
  },

  // 미발송 메시지 조회
  getPendingMessages() {
    return db.prepare(
      "SELECT * FROM messages WHERE sent = 0 AND scheduled_at <= datetime('now', 'localtime')"
    ).all();
  },

  // 전체 메시지 목록 (최근 순)
  getMessages(limit = 50, offset = 0) {
    return db.prepare(
      'SELECT * FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);
  },

  // 메시지 삭제 (예약 취소)
  deleteMessage(id) {
    return db.prepare('DELETE FROM messages WHERE id = ? AND sent = 0').run(id);
  },

  // 설정 조회
  getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  // 설정 저장
  setSetting(key, value) {
    db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run(key, value);
  },

  // 오늘 통계
  getTodayStats() {
    const today = new Date().toISOString().slice(0, 10);
    const total = db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE date(created_at) = ?"
    ).get(today);
    const sent = db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE sent = 1 AND date(sent_at) = ?"
    ).get(today);
    const pending = db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE sent = 0 AND date(created_at) = ?"
    ).get(today);
    const failed = db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE sent = -1 AND date(sent_at) = ?"
    ).get(today);
    return {
      total: total.count,
      sent: sent.count,
      pending: pending.count,
      failed: failed.count
    };
  }
};
