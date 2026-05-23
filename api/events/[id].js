const { pool, initDB } = require('../_db');
const { requireAuth, getToken, verifyToken } = require('../_auth');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  try {
    await initDB();

    if (req.method === 'GET') {
      const isSlug = isNaN(Number(id));
      const { rows } = await pool.query(
        isSlug ? 'SELECT * FROM events WHERE slug = $1' : 'SELECT * FROM events WHERE id = $1',
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Event not found' });
      const event = rows[0];
      // Only expose access_code to authenticated admins
      const token = getToken(req);
      const isAdmin = token ? !!verifyToken(token) : false;
      if (!isAdmin) delete event.access_code;
      return res.status(200).json(event);
    }

    if (req.method === 'PATCH') {
      const payload = requireAuth(req, res);
      if (!payload) return;
      const { access_code, regenerate_code } = req.body || {};
      let newCode;
      if (regenerate_code) {
        newCode = generateCode();
      } else if (access_code !== undefined) {
        const trimmed = String(access_code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!trimmed) return res.status(400).json({ error: 'Access code cannot be empty' });
        newCode = trimmed;
      } else {
        return res.status(400).json({ error: 'access_code or regenerate_code required' });
      }
      const { rows } = await pool.query(
        'UPDATE events SET access_code = $1 WHERE id = $2 RETURNING id, access_code',
        [newCode, id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Event not found' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const payload = requireAuth(req, res);
      if (!payload) return;
      await pool.query('DELETE FROM events WHERE id = $1', [id]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
