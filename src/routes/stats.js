const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  res.json({ status: 'ok', message: 'stats endpoint ready' });
});

module.exports = router;
