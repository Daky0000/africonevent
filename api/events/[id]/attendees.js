const { pool, initDB } = require('../../_db');
const { requireAuth, getToken, verifyToken } = require('../../_auth');
const { toLocalPhone } = require('../../_contact');

const FULL_LIST_SQL = `
  SELECT a.*,
    COALESCE(json_agg(ad.day_date::text ORDER BY ad.day_date) FILTER (WHERE ad.day_date IS NOT NULL), '[]') AS attendance_days
  FROM attendees a
  LEFT JOIN attendance_days ad ON ad.attendee_id = a.id
  WHERE a.event_id = $1
  GROUP BY a.id
  ORDER BY a.name ASC
`;

// Public view: name only. Contact details never leave the server — the page
// just needs to know which verification methods are available for each person.
const PUBLIC_LIST_SQL = `
  SELECT a.id, a.name, a.attended,
    (a.phone IS NOT NULL AND a.phone <> '') AS has_phone,
    (a.email IS NOT NULL AND a.email <> '') AS has_email,
    COALESCE(json_agg(ad.day_date::text ORDER BY ad.day_date) FILTER (WHERE ad.day_date IS NOT NULL), '[]') AS attendance_days
  FROM attendees a
  LEFT JOIN attendance_days ad ON ad.attendee_id = a.id
  WHERE a.event_id = $1
  GROUP BY a.id
  ORDER BY a.name ASC
`;

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  try {
    await initDB();

    if (req.method === 'GET') {
      const token = getToken(req);
      const isAdmin = token ? !!verifyToken(token) : false;
      const { rows } = await pool.query(isAdmin ? FULL_LIST_SQL : PUBLIC_LIST_SQL, [id]);
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
            [id, a.name.trim(), toLocalPhone(a.phone) || null, (a.email || '').trim() || null]
          );
          if (rows[0]) inserted.push(rows[0]);
        }
        return res.status(201).json(inserted);
      }

      const { name, phone, email } = body;
      if (!name) return res.status(400).json({ error: 'name is required' });
      const { rows } = await pool.query(
        'INSERT INTO attendees (event_id, name, phone, email) VALUES ($1,$2,$3,$4) RETURNING *',
        [id, name.trim(), toLocalPhone(phone) || null, (email || '').trim() || null]
      );
      return res.status(201).json(rows[0]);
    }

    if (req.method === 'PATCH') {
      const payload = requireAuth(req, res);
      if (!payload) return;
      const { day_date } = req.body || {};

      if (day_date) {
        // Per-day bulk mark: insert into attendance_days for all attendees not yet marked that day
        await pool.query(
          `INSERT INTO attendance_days (attendee_id, event_id, day_date)
           SELECT id, $1, $2 FROM attendees WHERE event_id = $1
           ON CONFLICT (attendee_id, day_date) DO NOTHING`,
          [id, day_date]
        );
        // Ensure attended flag is TRUE for all
        await pool.query(
          `UPDATE attendees SET attended = TRUE, attended_at = NOW()
           WHERE event_id = $1 AND attended = FALSE`,
          [id]
        );
        // Return all attendees with updated attendance_days
        const { rows } = await pool.query(FULL_LIST_SQL, [id]);
        return res.status(200).json(rows);
      }

      // Legacy: bulk mark all globally unattended
      const { rows } = await pool.query(
        `UPDATE attendees SET attended = TRUE, attended_at = NOW()
         WHERE event_id = $1 AND attended = FALSE
         RETURNING *`,
        [id]
      );
      return res.status(200).json(rows);
    }

    if (req.method === 'DELETE') {
      const payload = requireAuth(req, res);
      if (!payload) return;
      const { attendee_id, attendee_ids, all } = req.body || {};

      if (all === true) {
        const { rowCount } = await pool.query('DELETE FROM attendees WHERE event_id = $1', [id]);
        return res.status(200).json({ ok: true, deleted: rowCount, ids: [] });
      }

      const ids = (Array.isArray(attendee_ids) ? attendee_ids : (attendee_id ? [attendee_id] : []))
        .map(Number)
        .filter(n => Number.isInteger(n) && n > 0);

      if (!ids.length) return res.status(400).json({ error: 'attendee_id, attendee_ids or all required' });

      const { rows } = await pool.query(
        'DELETE FROM attendees WHERE id = ANY($1::int[]) AND event_id = $2 RETURNING id',
        [ids, id]
      );
      return res.status(200).json({ ok: true, deleted: rows.length, ids: rows.map(r => r.id) });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
