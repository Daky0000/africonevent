const bcrypt = require('bcryptjs');
const { pool, initDB } = require('./_db');
const { requireAuth } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const payload = requireAuth(req, res);
  if (!payload) return;

  try {
    await initDB();

    if (req.method === 'GET') {
      const { rows } = await pool.query(
        'SELECT id, name, email, created_at FROM admins ORDER BY created_at ASC'
      );
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { name, email, password } = req.body || {};
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'name, email and password are required' });
      }
      const hash = await bcrypt.hash(password, 10);
      const { rows } = await pool.query(
        'INSERT INTO admins (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
        [name, email.toLowerCase(), hash]
      );
      return res.status(201).json(rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
};
