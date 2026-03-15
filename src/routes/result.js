const express = require('express');
const router = express.Router();

router.post('/result', async (req, res) => {
  res.json({ status: 'ok', message: 'result endpoint ready' });
});

module.exports = router;
