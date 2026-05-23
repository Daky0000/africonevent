const { pool, initDB } = require('../_db');
const { requireAuth } = require('../_auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const payload = requireAuth(req, res);
  if (!payload) return;

  try {
    await initDB();
    const { rows } = await pool.query(
      'SELECT id, name, email, created_at FROM admins WHERE id = $1',
      [payload.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.status(200).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
