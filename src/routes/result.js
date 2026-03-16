const express = require('express');
const router = express.Router();
const pool = require('../db');
const { getIpHash } = require('../middlewares/ipHash');

router.post('/result', async (req, res) => {
  const { session_id, app_id = 'lovetype', cache_key, mbti, axis_strength, result_data } = req.body;

  if (!session_id || !cache_key || !mbti || !axis_strength) {
    return res.status(400).json({ error: 'session_id, cache_key, mbti, axis_strength 필수' });
  }

  const ip_hash = getIpHash(req);
  const date_kst = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }).replace(/\. /g, '-').replace('.', '');

  try {
    const limitCheck = await pool.query(
      `SELECT COUNT(*) FROM svil_results
       WHERE session_id = $1 AND app_id = $2 AND date_kst = $3`,
      [session_id, app_id, date_kst]
    );

    const todayCount = parseInt(limitCheck.rows[0].count);

    if (todayCount >= 3) {
      return res.status(429).json({
        error: 'daily_limit',
        message: '오늘은 최대 3번까지 테스트할 수 있어요.',
        next_available: 'tomorrow'
      });
    }

    await pool.query(
      `INSERT INTO svil_results
        (app_id, session_id, cache_key, mbti, axis_strength, result_data, date_kst)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [app_id, session_id, cache_key, mbti, JSON.stringify(axis_strength), JSON.stringify(result_data), date_kst]
    );

    await pool.query(
      `INSERT INTO svil_sessions
        (app_id, session_id, ip_hash, date_kst)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [app_id, session_id, ip_hash, date_kst]
    ).catch(() => {});

    res.json({ success: true, today_count: todayCount + 1 });

  } catch (err) {
    console.error('[result] DB 오류:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
