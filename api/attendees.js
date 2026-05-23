const { pool, initDB } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    await initDB();

    if (req.method === 'GET') {
      const { rows } = await pool.query(
        'SELECT * FROM attendees ORDER BY name ASC'
      );
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { name, phone } = req.body || {};
      if (!name || !phone) {
        return res.status(400).json({ error: 'name and phone are required' });
      }
      const { rows } = await pool.query(
        'INSERT INTO attendees (name, phone) VALUES ($1, $2) RETURNING *',
        [name.trim(), phone.trim()]
      );
      return res.status(201).json(rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
