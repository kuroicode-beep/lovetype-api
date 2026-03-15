const express = require('express');
const router = express.Router();

router.post('/compatibility', async (req, res) => {
  res.json({ status: 'ok', message: 'compatibility endpoint ready' });
});

module.exports = router;
