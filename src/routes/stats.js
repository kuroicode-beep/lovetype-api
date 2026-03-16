const express = require('express');
const router = express.Router();
const { getCacheStats } = require('../services/cache');
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const cacheStats = await getCacheStats('lovetype');

    const dailyStats = await pool.query(
      `SELECT date_kst, test_completes, total_sessions
       FROM svil_stats_daily
       WHERE app_id = 'lovetype'
       ORDER BY date_kst DESC
       LIMIT 7`
    );

    res.json({
      cache: cacheStats,
      daily: dailyStats.rows
    });

  } catch (err) {
    console.error('[stats] 오류:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
