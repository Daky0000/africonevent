const bcrypt = require('bcryptjs');
const { pool, initDB } = require('../_db');
const { signToken } = require('../_auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDB();
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const { rows } = await pool.query(
      'SELECT * FROM admins WHERE username = $1 OR email = $1',
      [username]
    );
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = rows[0];
    const token = signToken({ id: admin.id, username: admin.username, name: admin.name });
    res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`);
    res.status(200).json({ token, admin: { id: admin.id, name: admin.name, username: admin.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
