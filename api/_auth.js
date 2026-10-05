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

// Participant portal links use their own secret so a portal token can never
// pass as an admin token (and vice versa).
const PORTAL_SECRET = SECRET + ':sprint-portal';

function signPortalToken(attendeeId) {
  return jwt.sign({ aid: attendeeId, typ: 'portal' }, PORTAL_SECRET, { expiresIn: '180d' });
}

function verifyPortalToken(token) {
  try {
    const p = jwt.verify(token, PORTAL_SECRET);
    return p && p.typ === 'portal' ? p : null;
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyToken, getToken, requireAuth, signPortalToken, verifyPortalToken };
