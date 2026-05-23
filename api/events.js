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
          COUNT(a.id)::int AS total_attendees,
          COALESCE(SUM(CASE WHEN a.attended THEN 1 ELSE 0 END),0)::int AS attended_count
        FROM events e
        LEFT JOIN attendees a ON a.event_id = e.id
        GROUP BY e.id
        ORDER BY e.start_date DESC
      `);
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { name, description, start_date, end_date, slug, repeat } = req.body || {};
      if (!name || !start_date || !slug) {
        return res.status(400).json({ error: 'name, start_date and slug are required' });
      }

      const baseSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

      // Single event (no repeat)
      if (!repeat || repeat.count <= 1) {
        const { rows } = await pool.query(
          'INSERT INTO events (name, description, start_date, end_date, slug, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
          [name, description || null, start_date, end_date || null, baseSlug, payload.id]
        );
        return res.status(201).json([rows[0]]);
      }

      // Repeating events — create N events spaced by frequency
      const { count, frequency } = repeat; // frequency: 'weekly' | 'biweekly' | 'monthly'
      const dayGaps = { weekly: 7, biweekly: 14, monthly: 28 };
      const gap = dayGaps[frequency] || 7;
      const created = [];

      for (let i = 0; i < count; i++) {
        const sDate = addDays(start_date, gap * i);
        const eDate = end_date ? addDays(end_date, gap * i) : null;
        const eventSlug = `${baseSlug}-${i + 1}`;
        const eventName = `${name} (${ordinal(i + 1)})`;
        try {
          const { rows } = await pool.query(
            'INSERT INTO events (name, description, start_date, end_date, slug, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
            [eventName, description || null, sDate, eDate, eventSlug, payload.id]
          );
          created.push(rows[0]);
        } catch (e) {
          if (e.code !== '23505') throw e; // ignore slug conflicts
        }
      }
      return res.status(201).json(created);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists — try a different name' });
    res.status(500).json({ error: err.message });
  }
};

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}
