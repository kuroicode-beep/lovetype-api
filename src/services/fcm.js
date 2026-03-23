const admin = require('firebase-admin');

function getMessaging() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) return null;
  try {
    if (!admin.apps.length) {
      const cred = JSON.parse(raw);
      admin.initializeApp({ credential: admin.credential.cert(cred) });
    }
    return admin.messaging();
  } catch (e) {
    console.error('[fcm] 초기화 실패:', e.message);
    return null;
  }
}

/**
 * @param {string[]} tokens
 * @param {{ title: string, body: string, data?: Record<string,string> }} payload
 */
async function sendMulticast(tokens, { title, body, data = {} }) {
  const messaging = getMessaging();
  if (!messaging) return null;
  if (!tokens.length) return { successCount: 0, failureCount: 0 };

  const res = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    ),
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  });
  return {
    successCount: res.successCount,
    failureCount: res.failureCount,
  };
}

module.exports = { getMessaging, sendMulticast };
