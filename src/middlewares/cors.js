const cors = require('cors');

module.exports = cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
});
