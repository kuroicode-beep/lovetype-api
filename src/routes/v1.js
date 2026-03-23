const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../db');
const { generateTarotStory } = require('../services/tarotAi');
const { sendMulticast } = require('../services/fcm');

const router = express.Router();

const TAROT_APP_ID = 'lovetype-tarot';
const COOLDOWN_SEC = 3600;

const PRODUCT_CREDITS = {
  tarot_10p: 10,
  tarot_1: 1,
  tarot_6: 6,
  tarot_13: 13,
  tarot_40: 40,
};

function themeToCategory(theme) {
  if (!theme) return 'other';
  const t = String(theme);
  // Unicode escapes — avoid source file encoding issues on Windows
  if (t.includes('\uC5F0\uC560') || /romance/i.test(t)) return 'romance';
  if (t.includes('\uC624\uB298') || /daily/i.test(t)) return 'daily';
  return 'other';
}

function parseDateYmd(s) {
  if (!s) return null;
  const d = new Date(`${s}T12:00:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : s;
}

async function ensureWallet(client, appId, userId) {
  await client.query(
    `INSERT INTO lovetype_tarot_wallet (app_id, user_id, balance)
     VALUES ($1, $2, 0)
     ON CONFLICT (app_id, user_id) DO NOTHING`,
    [appId, userId]
  );
}

async function getWalletRow(client, appId, userId) {
  await ensureWallet(client, appId, userId);
  const { rows } = await client.query(
    `SELECT balance, is_subscribed, sub_expires_at
     FROM lovetype_tarot_wallet WHERE app_id = $1 AND user_id = $2`,
    [appId, userId]
  );
  return rows[0];
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

// Tarot reading history (POST save, GET list)
router.post('/tarot/history', async (req, res) => {
  const {
    app_id,
    user_id,
    date,
    theme,
    tags,
    cards,
    story,
    soul_card,
    mbti,
  } = req.body;

  if (app_id !== TAROT_APP_ID || !user_id || !story) {
    return res.status(400).json({
      error: 'app_id(lovetype-tarot), user_id, story required',
    });
  }

  const client = await pool.connect();
  try {
    const readingDate = parseDateYmd(date) || new Date().toISOString().slice(0, 10);
    const ins = await client.query(
      `INSERT INTO lovetype_tarot_readings
        (app_id, user_id, reading_date, theme, tags, cards, story, soul_card, mbti)
       VALUES ($1,$2,$3::date,$4,$5::jsonb,$6::jsonb,$7,$8,$9)
       RETURNING id`,
      [
        app_id,
        user_id,
        readingDate,
        theme || null,
        JSON.stringify(Array.isArray(tags) ? tags : []),
        JSON.stringify(Array.isArray(cards) ? cards : []),
        story,
        soul_card != null ? Number(soul_card) : null,
        mbti || null,
      ]
    );
    const id = ins.rows[0].id;

    const cat = themeToCategory(theme);
    if (cat === 'daily' || cat === 'romance') {
      await client.query(
        `INSERT INTO lovetype_tarot_cooldown (app_id, user_id, category, last_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (app_id, user_id, category) DO UPDATE SET last_at = NOW()`,
        [app_id, user_id, cat]
      );
    }

    res.json({ id: String(id), success: true });
  } catch (err) {
    console.error('[v1 tarot/history POST]', err);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

router.get('/tarot/history', async (req, res) => {
  const { app_id, user_id, limit = '20' } = req.query;
  if (app_id !== TAROT_APP_ID || !user_id) {
    return res.status(400).json({ error: 'app_id, user_id required' });
  }
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  try {
    const { rows } = await pool.query(
      `SELECT id, reading_date, theme, tags, cards, story, soul_card, mbti, created_at
       FROM lovetype_tarot_readings
       WHERE app_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [app_id, user_id, lim]
    );
    res.json({
      success: true,
      items: rows.map((r) => ({
        id: String(r.id),
        date: r.reading_date,
        theme: r.theme,
        tags: r.tags,
        cards: r.cards,
        story: r.story,
        soul_card: r.soul_card,
        mbti: r.mbti,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    console.error('[v1 tarot/history GET]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Cooldown status
router.get('/tarot/cooltime', async (req, res) => {
  const { app_id, user_id, theme } = req.query;
  if (app_id !== TAROT_APP_ID || !user_id) {
    return res.status(400).json({ error: 'app_id, user_id required' });
  }
  const cat = themeToCategory(theme);
  if (cat !== 'daily' && cat !== 'romance') {
    return res.json({ available: true, remaining_seconds: 0 });
  }

  try {
    const { rows } = await pool.query(
      `SELECT last_at FROM lovetype_tarot_cooldown
       WHERE app_id = $1 AND user_id = $2 AND category = $3`,
      [app_id, user_id, cat]
    );
    if (!rows.length) {
      return res.json({ available: true, remaining_seconds: 0 });
    }
    const last = new Date(rows[0].last_at).getTime();
    const elapsed = (Date.now() - last) / 1000;
    const remaining = COOLDOWN_SEC - elapsed;
    if (remaining <= 0) {
      return res.json({ available: true, remaining_seconds: 0 });
    }
    return res.json({
      available: false,
      remaining_seconds: Math.ceil(remaining),
    });
  } catch (err) {
    console.error('[v1 tarot/cooltime]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// AI tarot story (Flutter POST /api/v1/tarot)
router.post('/tarot', async (req, res) => {
  const { app_id, prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'prompt required' });
  }
  if (app_id && app_id !== TAROT_APP_ID) {
    return res.status(400).json({ error: 'unsupported app_id' });
  }
  try {
    const text = await generateTarotStory(prompt);
    res.json({ result: text, success: true });
  } catch (err) {
    console.error('[v1 tarot]', err.message);
    res.status(500).json({ error: 'tarot_generation_failed', message: err.message });
  }
});

// Payment balance
router.get('/payment/balance', async (req, res) => {
  const { app_id, user_id } = req.query;
  if (app_id !== TAROT_APP_ID || !user_id) {
    return res.status(400).json({ error: 'app_id, user_id required' });
  }

  const client = await pool.connect();
  try {
    const row = await getWalletRow(client, app_id, user_id);
    res.json({
      success: true,
      balance: row.balance,
      is_subscribed: row.is_subscribed,
      sub_expires: row.sub_expires_at
        ? row.sub_expires_at.toISOString()
        : null,
    });
  } catch (err) {
    console.error('[v1 payment/balance]', err);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Payment use (deduct)
router.post('/payment/use', async (req, res) => {
  const { app_id, user_id, amount, reason } = req.body;
  if (app_id !== TAROT_APP_ID || !user_id || amount == null) {
    return res.status(400).json({ error: 'app_id, user_id, amount required' });
  }
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    return res.status(400).json({ error: 'invalid amount' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await getWalletRow(client, app_id, user_id);
    if (row.balance < n) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'insufficient_balance',
        balance: row.balance,
      });
    }
    await client.query(
      `UPDATE lovetype_tarot_wallet SET balance = balance - $3, updated_at = NOW()
       WHERE app_id = $1 AND user_id = $2`,
      [app_id, user_id, n]
    );
    await client.query('COMMIT');
    const after = await getWalletRow(client, app_id, user_id);
    console.log('[payment/use]', { user_id, amount: n, reason: reason || '' });
    res.json({ success: true, balance: after.balance });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[v1 payment/use]', err);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Payment charge
router.post('/payment/charge', async (req, res) => {
  const { app_id, user_id, amount, product_id, receipt } = req.body;
  if (app_id !== TAROT_APP_ID || !user_id || !product_id) {
    return res.status(400).json({ error: 'app_id, user_id, product_id required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureWallet(client, app_id, user_id);

    if (product_id === 'tarot_sub') {
      const days = Number(process.env.SUBSCRIPTION_DAYS || 30);
      await client.query(
        `UPDATE lovetype_tarot_wallet SET
           is_subscribed = TRUE,
           sub_expires_at = GREATEST(COALESCE(sub_expires_at, NOW()), NOW())
             + ($3::integer * INTERVAL '1 day'),
           updated_at = NOW()
         WHERE app_id = $1 AND user_id = $2`,
        [app_id, user_id, days]
      );
    } else {
      let credit =
        PRODUCT_CREDITS[product_id] ??
        (Number.isFinite(Number(amount)) ? Number(amount) : 0);
      if (credit <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'unknown product_id' });
      }
      await client.query(
        `UPDATE lovetype_tarot_wallet SET balance = balance + $3, updated_at = NOW()
         WHERE app_id = $1 AND user_id = $2`,
        [app_id, user_id, credit]
      );
    }

    await client.query('COMMIT');
    const row = await getWalletRow(client, app_id, user_id);
    if (receipt) {
      console.log('[payment/charge] receipt length', String(receipt).length);
    }
    res.json({
      success: true,
      balance: row.balance,
      is_subscribed: row.is_subscribed,
      sub_expires: row.sub_expires_at
        ? row.sub_expires_at.toISOString()
        : null,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[v1 payment/charge]', err);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Google sign-in
router.post('/auth/google', async (req, res) => {
  const { app_id, id_token, soul_card, nickname, gender, mbti } = req.body;
  if (app_id !== TAROT_APP_ID || !id_token) {
    return res.status(400).json({ error: 'app_id(lovetype-tarot), id_token required' });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  let googleSub;
  if (clientId) {
    try {
      const oAuth = new OAuth2Client(clientId);
      const ticket = await oAuth.verifyIdToken({
        idToken: id_token,
        audience: clientId,
      });
      googleSub = ticket.getPayload().sub;
    } catch (e) {
      console.error('[v1 auth/google] verify fail', e.message);
      return res.status(401).json({ error: 'invalid_id_token' });
    }
  } else if (process.env.NODE_ENV !== 'production') {
    console.warn('[v1 auth/google] GOOGLE_CLIENT_ID unset — dev-only JWT payload parse');
    try {
      const parts = id_token.split('.');
      if (parts.length < 2) throw new Error('bad jwt');
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8')
      );
      googleSub = payload.sub;
      if (!googleSub) throw new Error('no sub');
    } catch (e) {
      return res.status(401).json({ error: 'invalid_id_token' });
    }
  } else {
    return res.status(503).json({ error: 'google_auth_not_configured' });
  }

  const client = await pool.connect();
  try {
    const existed = await client.query(
      `SELECT 1 FROM lovetype_tarot_users WHERE app_id = $1 AND user_id = $2`,
      [app_id, googleSub]
    );
    const isNew = existed.rows.length === 0;

    await client.query(
      `INSERT INTO lovetype_tarot_users (app_id, user_id, nickname, gender, mbti, soul_card, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (app_id, user_id) DO UPDATE SET
         nickname = COALESCE(EXCLUDED.nickname, lovetype_tarot_users.nickname),
         gender = COALESCE(EXCLUDED.gender, lovetype_tarot_users.gender),
         mbti = COALESCE(EXCLUDED.mbti, lovetype_tarot_users.mbti),
         soul_card = COALESCE(EXCLUDED.soul_card, lovetype_tarot_users.soul_card),
         updated_at = NOW()`,
      [
        app_id,
        googleSub,
        nickname || null,
        gender || null,
        mbti || null,
        soul_card != null ? Number(soul_card) : null,
      ]
    );

    await client.query(
      `INSERT INTO lovetype_tarot_wallet (app_id, user_id, balance)
       VALUES ($1, $2, $3)
       ON CONFLICT (app_id, user_id) DO NOTHING`,
      [app_id, googleSub, isNew ? 20 : 0]
    );

    res.json({
      success: true,
      user_id: googleSub,
      is_new: isNew,
    });
  } catch (err) {
    console.error('[v1 auth/google]', err);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// FCM token register
router.post('/push/register', async (req, res) => {
  const { app_id, user_id, fcm_token } = req.body;
  if (app_id !== TAROT_APP_ID || !user_id || !fcm_token) {
    return res.status(400).json({ error: 'app_id, user_id, fcm_token required' });
  }
  try {
    await pool.query(
      `INSERT INTO lovetype_tarot_push (app_id, user_id, fcm_token, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (app_id, user_id) DO UPDATE SET
         fcm_token = EXCLUDED.fcm_token, updated_at = NOW()`,
      [app_id, user_id, fcm_token]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[v1 push/register]', err);
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
