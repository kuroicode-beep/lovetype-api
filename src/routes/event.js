const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  res.json({ status: 'ok', message: 'event endpoint ready' });
});

module.exports = router;
