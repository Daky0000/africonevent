const { pool, initDB } = require('../_db');
const { requireAuth } = require('../_auth');

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
