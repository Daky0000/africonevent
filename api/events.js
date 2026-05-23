const { pool, initDB } = require('./_db');
const { requireAuth } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const payload = requireAuth(req, res);
  if (!payload) return;

  try {
    await initDB();

    if (req.method === 'GET') {
      const { rows } = await pool.query(`
        SELECT e.*,
          COUNT(a.id)::int                                        AS total_attendees,
          COALESCE(SUM(CASE WHEN a.attended THEN 1 ELSE 0 END),0)::int AS attended_count
        FROM events e
        LEFT JOIN attendees a ON a.event_id = e.id
        GROUP BY e.id
        ORDER BY e.event_date DESC
      `);
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { name, description, event_date, slug } = req.body || {};
      if (!name || !event_date || !slug) {
        return res.status(400).json({ error: 'name, event_date and slug are required' });
      }
      const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      const { rows } = await pool.query(
        'INSERT INTO events (name, description, event_date, slug, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [name, description || null, event_date, cleanSlug, payload.id]
      );
      return res.status(201).json(rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    res.status(500).json({ error: err.message });
  }
};
