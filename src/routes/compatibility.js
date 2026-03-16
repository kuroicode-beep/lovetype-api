const express = require('express');
const router = express.Router();
const { getCompatibility } = require('../services/deepseek');
const { getCachedCompatibility, setCachedCompatibility } = require('../services/cache');

router.post('/compatibility', async (req, res) => {
  const { mbti, axis_strength, app_id = 'lovetype' } = req.body;

  if (!mbti || !axis_strength) {
    return res.status(400).json({ error: 'mbti, axis_strength 필수' });
  }

  const cache_key = `${mbti}__${Object.values(axis_strength).join('__')}__compat__v1`;

  try {
    const cached = await getCachedCompatibility(app_id, cache_key);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const result = await getCompatibility(mbti, axis_strength);

    await setCachedCompatibility(app_id, cache_key, mbti, axis_strength, result);

    res.json({ ...result, cached: false });

  } catch (err) {
    console.error('[compatibility] 오류:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
