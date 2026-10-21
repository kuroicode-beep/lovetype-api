// src/routes/secureTarot.js
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { verifyPlayReceipt, failure } = require('../services/storeVerification');
const APP = 'lovetype-tarot';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Verify signed Google ID tokens against the configured web OAuth client.
async function verifyGoogle(token) {
  if (!process.env.GOOGLE_CLIENT_ID) throw failure(503, 'google_auth_not_configured');
  try {
    const ticket = await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email_verified) throw new Error();
    return payload.sub;
  } catch { throw failure(401, 'invalid_id_token'); }
}
// Serialize operations on the same user's wallet across server instances.
async function lockUser(client, userId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${APP}:${userId}`]);
}
// Load an existing wallet while excluding expired subscriptions.
async function wallet(client, userId) {
  const { rows } = await client.query(`SELECT balance, (is_subscribed AND sub_expires_at > NOW()) AS is_subscribed, sub_expires_at AS sub_expires FROM lovetype_tarot_wallet WHERE app_id=$1 AND user_id=$2`, [APP, userId]);
  if (!rows[0]) throw failure(409, 'login_required');
  return rows[0];
}
// Build injectable routes so regression tests never contact real stores or databases.
function createSecureTarotRouter({ pool, generateStory, getSettings, verifyToken = verifyGoogle, verifyReceipt = verifyPlayReceipt }) {
  const router = express.Router();
  const handle = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (err) { res.status(err.status || 500).json({ error: err.code || 'internal_error' }); }
  };
  // Verify ownership once for all customer endpoints, leaving the admin router separate.
  router.use(['/tarot', '/payment', '/push/register'], async (req, res, next) => {
    try {
    const token = /^Bearer (.+)$/.exec(req.get('authorization') || '')?.[1];
    if (!token) throw failure(401, 'authentication_required');
    req.userId = await verifyToken(token);
    const data = req.method === 'GET' ? req.query : req.body;
    if (data.app_id !== APP) throw failure(400, 'invalid_app');
    if (data.user_id && data.user_id !== req.userId) throw failure(403, 'user_mismatch');
    next();
    } catch (err) { res.status(err.status || 500).json({ error: err.code || 'internal_error' }); }
  });

  router.post('/auth/google', handle(async (req, res) => {
    if (req.body.app_id !== APP || typeof req.body.id_token !== 'string') throw failure(400, 'invalid_auth_request');
    const userId = await verifyToken(req.body.id_token);
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await lockUser(client, userId);
      const created = await client.query(`INSERT INTO lovetype_tarot_users(app_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id`, [APP, userId]);
      await client.query(`INSERT INTO lovetype_tarot_wallet(app_id,user_id,balance) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [APP, userId, created.rows.length ? 20 : 0]);
      await client.query('COMMIT'); res.json({ success: true, user_id: userId, is_new: !!created.rows.length });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  }));
  router.get('/payment/balance', handle(async (req, res) => res.json({ success: true, ...await wallet(pool, req.userId) })));
  // Charging a reading is part of generation; arbitrary client deductions are disabled.
  router.post('/payment/use', handle(async () => { throw failure(410, 'use_reading_endpoint'); }));
  router.post('/payment/charge', handle(async (req, res) => {
    const verified = await verifyReceipt(req.body, req.userId);
    const client = await pool.connect();
    let duplicate;
    try {
      await client.query('BEGIN'); await lockUser(client, req.userId);
      const old = await client.query('SELECT user_id,product_id FROM lovetype_tarot_verified_purchases WHERE receipt_key=$1', [verified.key]);
      if (old.rows[0] && (old.rows[0].user_id !== req.userId || old.rows[0].product_id !== verified.productId)) throw failure(403, 'purchase_owner_mismatch');
      duplicate = old.rows.length > 0;
      if (!duplicate) {
        await client.query('INSERT INTO lovetype_tarot_verified_purchases(receipt_key,user_id,product_id) VALUES($1,$2,$3)', [verified.key, req.userId, verified.productId]);
        if (!verified.expiresAt) await client.query('UPDATE lovetype_tarot_wallet SET balance=balance+$3,updated_at=NOW() WHERE app_id=$1 AND user_id=$2', [APP, req.userId, verified.credits]);
      }
      if (verified.expiresAt) await client.query('UPDATE lovetype_tarot_wallet SET is_subscribed=TRUE,sub_expires_at=$3,updated_at=NOW() WHERE app_id=$1 AND user_id=$2', [APP, req.userId, verified.expiresAt]);
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
    await verified.finish();
    res.json({ success: true, duplicate, ...await wallet(pool, req.userId) });
  }));
  // Accept the documented topic and older theme query without accepting unknown categories.
  router.get('/tarot/cooltime', handle(async (req, res) => {
    const topic = req.query.topic || (/연애|romance/i.test(req.query.theme || '') ? 'romance' : /오늘|daily/i.test(req.query.theme || '') ? 'daily' : null);
    if (!['daily', 'romance'].includes(topic)) throw failure(400, 'invalid_topic');
    const { rows } = await pool.query('SELECT last_at FROM lovetype_tarot_cooldown WHERE app_id=$1 AND user_id=$2 AND category=$3', [APP, req.userId, topic]);
    const settings = await getSettings();
    const seconds = Number(topic === 'daily' ? settings.cooldown_daily_sec : settings.cooldown_romance_sec);
    const remaining = rows.length ? Math.max(0, Math.ceil(seconds - (Date.now() - new Date(rows[0].last_at).getTime()) / 1000)) : 0;
    res.json({ available: remaining === 0, remaining_seconds: remaining });
  }));
  // Generate, save, charge and start cooldown in one transaction; retries reuse request_id.
  router.post('/tarot', handle(async (req, res) => {
    const b = req.body;
    if (!['daily', 'romance'].includes(b.topic) || !UUID.test(b.request_id || '') || typeof b.prompt !== 'string' || b.prompt.length > 12000 || !b.prompt.trim()) throw failure(400, 'invalid_reading_request');
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await lockUser(client, req.userId);
      const existing = await client.query('SELECT id,story FROM lovetype_tarot_readings WHERE app_id=$1 AND user_id=$2 AND client_reading_id=$3', [APP, req.userId, b.request_id]);
      if (existing.rows.length) { await client.query('COMMIT'); return res.json({ success: true, result: existing.rows[0].story, reading_id: existing.rows[0].id }); }
      const settings = await getSettings();
      const { rows } = await client.query('SELECT last_at FROM lovetype_tarot_cooldown WHERE app_id=$1 AND user_id=$2 AND category=$3', [APP, req.userId, b.topic]);
      const limit = Number(b.topic === 'daily' ? settings.cooldown_daily_sec : settings.cooldown_romance_sec);
      if (rows.length && Date.now() - new Date(rows[0].last_at).getTime() < limit * 1000) throw failure(429, 'cooldown_active');
      const cost = b.topic === 'romance' ? 10 : 0;
      const current = await wallet(client, req.userId);
      if (current.balance < cost) throw failure(402, 'insufficient_balance');
      const story = await generateStory(b.prompt);
      const saved = await client.query(`INSERT INTO lovetype_tarot_readings(app_id,user_id,reading_date,theme,tags,cards,story,soul_card,mbti,client_reading_id) VALUES($1,$2,(NOW() AT TIME ZONE 'Asia/Seoul')::date,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9) RETURNING id`, [APP,req.userId,b.topic === 'romance' ? '연애 이야기' : '오늘의 이야기',JSON.stringify(b.tags || []),JSON.stringify(b.cards || []),story,b.soul_card || null,b.user_mbti || null,b.request_id]);
      if (cost) await client.query('UPDATE lovetype_tarot_wallet SET balance=$3,updated_at=NOW() WHERE app_id=$1 AND user_id=$2', [APP,req.userId,current.balance - cost]);
      await client.query(`INSERT INTO lovetype_tarot_cooldown(app_id,user_id,category,last_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(app_id,user_id,category) DO UPDATE SET last_at=NOW()`, [APP,req.userId,b.topic]);
      await client.query('COMMIT'); res.json({ success: true, result: story, reading_id: saved.rows[0].id });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  }));
  router.get('/tarot/history', handle(async (req, res) => {
    const limit = Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10) || 20));
    const { rows } = await pool.query('SELECT id,reading_date AS date,theme,tags,cards,story,soul_card,mbti,created_at FROM lovetype_tarot_readings WHERE app_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT $3', [APP,req.userId,limit]);
    res.json({ success: true, items: rows });
  }));
  // Idempotent import of offline history never changes balances or cooldowns.
  router.post('/tarot/history', handle(async (req, res) => {
    const b = req.body;
    if (b.reading_id) {
      const { rows } = await pool.query('SELECT id FROM lovetype_tarot_readings WHERE app_id=$1 AND user_id=$2 AND id=$3', [APP,req.userId,b.reading_id]);
      if (!rows.length) throw failure(404, 'reading_not_found');
      return res.json({ success: true, id: rows[0].id });
    }
    if (typeof b.client_reading_id !== 'string' || b.client_reading_id.length > 128 || typeof b.story !== 'string' || !b.story || b.story.length > 20000) throw failure(400, 'invalid_history');
    const { rows } = await pool.query(`INSERT INTO lovetype_tarot_readings(app_id,user_id,theme,tags,cards,story,client_reading_id) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) ON CONFLICT(app_id,user_id,client_reading_id) DO UPDATE SET client_reading_id=EXCLUDED.client_reading_id RETURNING id`, [APP,req.userId,b.theme || null,JSON.stringify(b.tags || []),JSON.stringify(b.cards || []),b.story,b.client_reading_id]);
    res.json({ success: true, id: rows[0].id });
  }));
  router.post('/push/register', handle(async (req, res) => {
    if (typeof req.body.fcm_token !== 'string' || !req.body.fcm_token) throw failure(400, 'token_required');
    await pool.query(`INSERT INTO lovetype_tarot_push(app_id,user_id,fcm_token) VALUES($1,$2,$3) ON CONFLICT(app_id,user_id) DO UPDATE SET fcm_token=EXCLUDED.fcm_token,updated_at=NOW()`,[APP,req.userId,req.body.fcm_token]);
    res.json({ success: true });
  }));
  return router;
}
module.exports = { createSecureTarotRouter, verifyGoogle };
