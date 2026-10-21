// src/routes/v1.js
const express = require('express');
const pool = require('../db');
const { generateTarotStory } = require('../services/tarotAi');
const { sendMulticast } = require('../services/fcm');
const { createSecureTarotRouter } = require('./secureTarot');
const router = express.Router();
const TAROT_APP_ID = 'lovetype-tarot';
const COOLDOWN_SEC = 3600;

async function getTarotSettings() {
  try {
    const { rows } = await pool.query(
      `SELECT cooldown_daily_sec, cooldown_romance_sec,
              deck_basic_enabled, deck_low_vision_enabled, deck_webtoon_enabled
       FROM lovetype_tarot_settings WHERE app_id = $1`,
      [TAROT_APP_ID]
    );
    if (rows.length) return rows[0];
  } catch (err) {
    console.warn('[getTarotSettings]', err.message);
  }
  return {
    cooldown_daily_sec: COOLDOWN_SEC,
    cooldown_romance_sec: COOLDOWN_SEC,
    deck_basic_enabled: true,
    deck_low_vision_enabled: true,
    deck_webtoon_enabled: true,
  };
}

function requireAdmin(req, res) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'admin_not_configured' });
    return false;
  }
  if (req.get('x-admin-key') !== key) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

router.use(createSecureTarotRouter({ pool, generateStory: generateTarotStory, getSettings: getTarotSettings }));

// --- Admin API (header: X-Admin-Key) ---
router.get('/admin/stats', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { rows: tc } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM lovetype_tarot_readings WHERE app_id = $1`,
      [TAROT_APP_ID]
    );
    const { rows: uc } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM lovetype_tarot_users WHERE app_id = $1`,
      [TAROT_APP_ID]
    );
    const { rows: pc } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM lovetype_tarot_push WHERE app_id = $1`,
      [TAROT_APP_ID]
    );
    const { rows: sc } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM lovetype_tarot_wallet
       WHERE app_id = $1 AND is_subscribed = TRUE
         AND (sub_expires_at IS NULL OR sub_expires_at > NOW())`,
      [TAROT_APP_ID]
    );
    const { rows: romanceC } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM lovetype_tarot_readings
       WHERE app_id = $1 AND (
         theme ILIKE '%연애%' OR LOWER(COALESCE(theme,'')) LIKE '%romance%'
       )`,
      [TAROT_APP_ID]
    );
    const { rows: dailyC } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM lovetype_tarot_readings
       WHERE app_id = $1 AND (
         theme ILIKE '%오늘%' OR LOWER(COALESCE(theme,'')) LIKE '%daily%'
       )`,
      [TAROT_APP_ID]
    );
    const { rows: byDay } = await pool.query(
      `SELECT reading_date::text AS day, COUNT(*)::int AS cnt
       FROM lovetype_tarot_readings
       WHERE app_id = $1 AND reading_date IS NOT NULL
       GROUP BY reading_date
       ORDER BY reading_date DESC
       LIMIT 14`,
      [TAROT_APP_ID]
    );
    res.json({
      success: true,
      readings_total: tc[0].c,
      users_total: uc[0].c,
      push_tokens: pc[0].c,
      subscribed_active: sc[0].c,
      readings_romance: romanceC[0].c,
      readings_daily: dailyC[0].c,
      readings_by_day: byDay,
    });
  } catch (err) {
    console.error('[v1 admin/stats]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/admin/wallets', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const lim = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  try {
    const { rows } = await pool.query(
      `SELECT user_id, balance, is_subscribed, sub_expires_at, updated_at
       FROM lovetype_tarot_wallet
       WHERE app_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [TAROT_APP_ID, lim]
    );
    res.json({ success: true, items: rows });
  } catch (err) {
    console.error('[v1 admin/wallets]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/admin/charges', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const lim = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, product_id, is_subscription, created_at
       FROM lovetype_tarot_charge_log
       WHERE app_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [TAROT_APP_ID, lim]
    );
    res.json({ success: true, items: rows });
  } catch (err) {
    console.error('[v1 admin/charges]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/admin/settings', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const row = await getTarotSettings();
    res.json({ success: true, settings: row });
  } catch (err) {
    console.error('[v1 admin/settings GET]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.patch('/admin/settings', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const b = req.body || {};
  const clamp = (n, lo, hi, fallback) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(hi, Math.max(lo, Math.floor(v)));
  };
  try {
    const cur = await getTarotSettings();
    const cooldownDaily = clamp(
      b.cooldown_daily_sec,
      60,
      864000,
      cur.cooldown_daily_sec
    );
    const cooldownRomance = clamp(
      b.cooldown_romance_sec,
      60,
      864000,
      cur.cooldown_romance_sec
    );
    const deckBasic =
      b.deck_basic_enabled === undefined
        ? cur.deck_basic_enabled
        : Boolean(b.deck_basic_enabled);
    const deckLv =
      b.deck_low_vision_enabled === undefined
        ? cur.deck_low_vision_enabled
        : Boolean(b.deck_low_vision_enabled);
    const deckWb =
      b.deck_webtoon_enabled === undefined
        ? cur.deck_webtoon_enabled
        : Boolean(b.deck_webtoon_enabled);

    await pool.query(
      `INSERT INTO lovetype_tarot_settings (
         app_id, cooldown_daily_sec, cooldown_romance_sec,
         deck_basic_enabled, deck_low_vision_enabled, deck_webtoon_enabled, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (app_id) DO UPDATE SET
         cooldown_daily_sec = EXCLUDED.cooldown_daily_sec,
         cooldown_romance_sec = EXCLUDED.cooldown_romance_sec,
         deck_basic_enabled = EXCLUDED.deck_basic_enabled,
         deck_low_vision_enabled = EXCLUDED.deck_low_vision_enabled,
         deck_webtoon_enabled = EXCLUDED.deck_webtoon_enabled,
         updated_at = NOW()`,
      [
        TAROT_APP_ID,
        cooldownDaily,
        cooldownRomance,
        deckBasic,
        deckLv,
        deckWb,
      ]
    );
    const row = await getTarotSettings();
    res.json({ success: true, settings: row });
  } catch (err) {
    console.error('[v1 admin/settings PATCH]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Push send (admin)
router.post('/push/send', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { app_id, title, body, target } = req.body;
  if (app_id !== TAROT_APP_ID || !title || !body || !target) {
    return res.status(400).json({
      error: 'app_id(lovetype-tarot), title, body, target required',
    });
  }

  try {
    let tokens = [];
    if (target === 'all') {
      const r = await pool.query(
        `SELECT fcm_token FROM lovetype_tarot_push WHERE app_id = $1`,
        [app_id]
      );
      tokens = r.rows.map((x) => x.fcm_token).filter(Boolean);
    } else if (target === 'subscribed') {
      const r = await pool.query(
        `SELECT p.fcm_token
         FROM lovetype_tarot_push p
         INNER JOIN lovetype_tarot_wallet w
           ON w.app_id = p.app_id AND w.user_id = p.user_id
         WHERE p.app_id = $1
           AND w.is_subscribed = TRUE
           AND (w.sub_expires_at IS NULL OR w.sub_expires_at > NOW())`,
        [app_id]
      );
      tokens = r.rows.map((x) => x.fcm_token).filter(Boolean);
    } else {
      const r = await pool.query(
        `SELECT fcm_token FROM lovetype_tarot_push
         WHERE app_id = $1 AND user_id = $2`,
        [app_id, String(target)]
      );
      tokens = r.rows.map((x) => x.fcm_token).filter(Boolean);
    }

    const result = await sendMulticast(tokens, { title, body });
    if (!result) {
      return res.status(503).json({
        error: 'fcm_not_configured',
        token_count: tokens.length,
      });
    }
    res.json({
      success: true,
      token_count: tokens.length,
      ...result,
    });
  } catch (err) {
    console.error('[v1 push/send]', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

module.exports = router;
