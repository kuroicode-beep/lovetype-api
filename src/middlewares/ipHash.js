const crypto = require('crypto');

function getIpHash(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]
    || req.socket.remoteAddress
    || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex');
}

module.exports = { getIpHash };
