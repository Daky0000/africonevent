const { pool, initDB } = require('../../_db');
const { getToken, verifyToken } = require('../../_auth');

function getClientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

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

        const ip = getClientIP(req);

        // Check if this IP has already marked attendance for this event
        const { rows: ipRows } = await pool.query(
          `SELECT ai.ip_address, a.name
           FROM attendance_ips ai
           LEFT JOIN attendees a ON a.id = ai.attendee_id
           WHERE ai.event_id = $1 AND ai.ip_address = $2`,
          [id, ip]
        );
        if (ipRows.length) {
          return res.status(200).json({ ip_blocked: true, name: ipRows[0].name });
        }

        // Fetch attendee and mark
        const { rows: check } = await pool.query(
          'SELECT * FROM attendees WHERE id = $1 AND event_id = $2',
          [attendee_id, id]
        );
        if (!check.length) return res.status(404).json({ error: 'Attendee not found' });
        if (check[0].attended) return res.status(200).json(check[0]);

        const { rows } = await pool.query(
          'UPDATE attendees SET attended = TRUE, attended_at = NOW() WHERE id = $1 AND event_id = $2 RETURNING *',
          [attendee_id, id]
        );

        // Record the IP so this device can't mark again
        await pool.query(
          'INSERT INTO attendance_ips (event_id, ip_address, attendee_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [id, ip, attendee_id]
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
