const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'africon-default-secret-change-me';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '24h' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function getToken(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  if (m) return m[1];
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function requireAuth(req, res) {
  const token = getToken(req);
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: 'Invalid or expired token' }); return null; }
  return payload;
}

module.exports = { signToken, requireAuth };
