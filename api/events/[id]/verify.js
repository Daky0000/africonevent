const { pool, initDB } = require('../../_db');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDB();
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'code required' });

    const { rows } = await pool.query('SELECT access_code FROM events WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Event not found' });

    const stored = (rows[0].access_code || '').toUpperCase();
    const entered = code.trim().toUpperCase();

    if (!stored || stored !== entered) {
      return res.status(401).json({ valid: false, error: 'Invalid access code' });
    }

    return res.status(200).json({ valid: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
