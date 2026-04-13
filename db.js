const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    provider TEXT NOT NULL,
    provider_id TEXT,
    trial_expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    phone TEXT NOT NULL,
    message TEXT NOT NULL,
    order_source TEXT DEFAULT '배달의민족',
    scheduled_at TEXT NOT NULL,
    sent INTEGER DEFAULT 0,
    sent_at TEXT,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// messages 테이블에 user_id 컬럼 없으면 추가 (기존 DB 호환)
try {
  db.exec('ALTER TABLE messages ADD COLUMN user_id INTEGER REFERENCES users(id)');
} catch (e) { /* 이미 존재하면 무시 */ }

module.exports = {
  db,

  // ═══ 사용자 관리 ═══

  findOrCreateUser(email, name, provider, providerId) {
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      const trialExpires = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').slice(0, 19);
      db.prepare(
        'INSERT INTO users (email, name, provider, provider_id, trial_expires_at) VALUES (?, ?, ?, ?, ?)'
      ).run(email, name, provider, providerId, trialExpires);
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    }
    return user;
  },

  getUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  isTrialActive(user) {
    if (!user.trial_expires_at) return false;
    return new Date(user.trial_expires_at) > new Date();
  },

  // ═══ 사용자별 설정 ═══

  getUserSetting(userId, key) {
    const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key);
    if (row) return row.value;
    // 글로벌 기본값 폴백
    const global = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return global ? global.value : null;
  },

  setUserSetting(userId, key, value) {
    db.prepare(
      'INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)'
    ).run(userId, key, value);
  },

  // ═══ 메시지 (사용자별) ═══

  scheduleMessage(userId, phone, message, scheduledAt) {
    return db.prepare(
      'INSERT INTO messages (user_id, phone, message, scheduled_at) VALUES (?, ?, ?, ?)'
    ).run(userId, phone, message, scheduledAt);
  },

  markSent(id) {
    db.prepare(
      "UPDATE messages SET sent = 1, sent_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(id);
  },

  markFailed(id, error) {
    db.prepare(
      "UPDATE messages SET sent = -1, error = ?, sent_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(error, id);
  },

  getPendingMessages() {
    return db.prepare(
      "SELECT * FROM messages WHERE sent = 0 AND scheduled_at <= datetime('now', 'localtime')"
    ).all();
  },

  getMessages(userId, limit = 50, offset = 0) {
    return db.prepare(
      'SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(userId, limit, offset);
  },

  deleteMessage(id, userId) {
    return db.prepare('DELETE FROM messages WHERE id = ? AND user_id = ? AND sent = 0').run(id, userId);
  },

  // ═══ 글로벌 설정 (기본값) ═══

  getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  setSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  },

  getTodayStats(userId) {
    const today = new Date().toISOString().slice(0, 10);
    const total = db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND date(created_at) = ?"
    ).get(userId, today);
    const sent = db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND sent = 1 AND date(sent_at) = ?"
    ).get(userId, today);
    const pending = db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND sent = 0 AND date(created_at) = ?"
    ).get(userId, today);
    const failed = db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND sent = -1 AND date(sent_at) = ?"
    ).get(userId, today);
    return {
      total: total.count,
      sent: sent.count,
      pending: pending.count,
      failed: failed.count
    };
  }
};
