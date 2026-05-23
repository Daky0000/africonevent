const { pool, initDB } = require('../../_db');
const { requireAuth } = require('../../_auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  try {
    await initDB();

    if (req.method === 'GET') {
      const { rows } = await pool.query(
        'SELECT * FROM attendees WHERE event_id = $1 ORDER BY name ASC',
        [id]
      );
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const payload = requireAuth(req, res);
      if (!payload) return;
      const body = req.body || {};

      if (Array.isArray(body.attendees)) {
        const inserted = [];
        for (const a of body.attendees.filter(x => x.name)) {
          const { rows } = await pool.query(
            'INSERT INTO attendees (event_id, name, phone, email) VALUES ($1,$2,$3,$4) RETURNING *',
            [id, a.name.trim(), a.phone || null, a.email || null]
          );
          if (rows[0]) inserted.push(rows[0]);
        }
        return res.status(201).json(inserted);
      }

      const { name, phone, email } = body;
      if (!name) return res.status(400).json({ error: 'name is required' });
      const { rows } = await pool.query(
        'INSERT INTO attendees (event_id, name, phone, email) VALUES ($1,$2,$3,$4) RETURNING *',
        [id, name.trim(), phone || null, email || null]
      );
      return res.status(201).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const payload = requireAuth(req, res);
      if (!payload) return;
      const { attendee_id } = req.body || {};
      if (!attendee_id) return res.status(400).json({ error: 'attendee_id required' });
      await pool.query('DELETE FROM attendees WHERE id = $1 AND event_id = $2', [attendee_id, id]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
