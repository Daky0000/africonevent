const { pool, initDB } = require('../../_db');
const { getToken, verifyToken } = require('../../_auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  try {
    await initDB();

    if (req.method === 'PATCH') {
      const { attendee_id, code } = req.body || {};
      if (!attendee_id) return res.status(400).json({ error: 'attendee_id required' });

      const token = getToken(req);
      const isAdmin = token ? !!verifyToken(token) : false;

      if (!isAdmin) {
        // Public: require access code
        if (!code) return res.status(401).json({ error: 'Access code required' });
        const { rows: evRows } = await pool.query('SELECT access_code FROM events WHERE id = $1', [id]);
        if (!evRows.length) return res.status(404).json({ error: 'Event not found' });
        const stored = (evRows[0].access_code || '').toUpperCase();
        if (!stored || stored !== code.trim().toUpperCase()) {
          return res.status(401).json({ error: 'Invalid access code' });
        }

        // Public: only allow marking attended, never un-marking
        const { rows: check } = await pool.query(
          'SELECT * FROM attendees WHERE id = $1 AND event_id = $2',
          [attendee_id, id]
        );
        if (!check.length) return res.status(404).json({ error: 'Attendee not found' });
        if (check[0].attended) return res.status(200).json(check[0]); // already marked

        const { rows } = await pool.query(
          'UPDATE attendees SET attended = TRUE, attended_at = NOW() WHERE id = $1 AND event_id = $2 RETURNING *',
          [attendee_id, id]
        );
        return res.status(200).json(rows[0]);
      }

      // Admin: full toggle in both directions
      const { rows } = await pool.query(
        `UPDATE attendees
         SET attended    = NOT attended,
             attended_at = CASE WHEN NOT attended THEN NOW() ELSE NULL END
         WHERE id = $1 AND event_id = $2
         RETURNING *`,
        [attendee_id, id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Attendee not found' });
      return res.status(200).json(rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
