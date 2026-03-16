const express = require('express');
const router = express.Router();
const pool = require('../db');

router.post('/', async (req, res) => {
  const { session_id, app_id = 'lovetype', event_type, event_value, step } = req.body;

  if (!session_id || !event_type) {
    return res.status(400).json({ error: 'session_id, event_type 필수' });
  }

  try {
    await pool.query(
      `INSERT INTO svil_events (session_id, app_id, event_type, event_value, step)
       VALUES ($1, $2, $3, $4, $5)`,
      [session_id, app_id, event_type, event_value || null, step || null]
    );

    res.json({ success: true });

  } catch (err) {
    console.error('[event] DB 오류:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
