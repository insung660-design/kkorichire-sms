require('dotenv').config();

const API_KEY = process.env.SOLAPI_API_KEY;
const API_SECRET = process.env.SOLAPI_API_SECRET;
const SENDER_PHONE = process.env.SENDER_PHONE;

// Solapi(CoolSMS) API로 문자 발송
async function sendSMS(to, message) {
  // API 키가 없으면 시뮬레이션 모드
  if (!API_KEY || !API_SECRET) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[시뮬레이션] SMS 발송');
    console.log(`수신: ${to}`);
    console.log(`내용: ${message}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return { success: true, simulated: true };
  }

  try {
    const { default: fetch } = await import('node-fetch').catch(() => {
      return { default: globalThis.fetch };
    });

    const timestamp = Date.now().toString();
    const salt = Math.random().toString(36).substring(2, 15);
    const crypto = require('crypto');
    const signature = crypto
      .createHmac('sha256', API_SECRET)
      .update(timestamp + salt)
      .digest('hex');

    const response = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `HMAC-SHA256 apiKey=${API_KEY}, date=${timestamp}, salt=${salt}, signature=${signature}`
      },
      body: JSON.stringify({
        message: {
          to,
          from: SENDER_PHONE,
          text: message
        }
      })
    });

    const result = await response.json();

    if (response.ok) {
      console.log(`[SMS 발송 성공] ${to}`);
      return { success: true, result };
    } else {
      console.error(`[SMS 발송 실패] ${to}:`, result);
      return { success: false, error: JSON.stringify(result) };
    }
  } catch (err) {
    console.error(`[SMS 발송 오류] ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendSMS };
