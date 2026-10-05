const { pool, initDB } = require('../../_db');
const { getToken, verifyToken, signPortalToken } = require('../../_auth');
const { checkContact, clientIp } = require('../../_contact');

// Brute-force guards for the public verification step.
const ATTEMPT_WINDOW    = '15 minutes';
const MAX_PER_ATTENDEE  = 5;   // failed tries against one person
const MAX_PER_IP        = 20;  // failed tries from one device across the event

async function recentFailures(eventId, attendeeId, ip) {
  const [byAttendee, byIp] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS n FROM verification_attempts
       WHERE attendee_id = $1 AND succeeded = FALSE
         AND attempted_at > NOW() - INTERVAL '${ATTEMPT_WINDOW}'`,
      [attendeeId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM verification_attempts
       WHERE event_id = $1 AND ip_address = $2 AND succeeded = FALSE
         AND attempted_at > NOW() - INTERVAL '${ATTEMPT_WINDOW}'`,
      [eventId, ip]
    ),
  ]);
  return { attendee: byAttendee.rows[0].n, ip: byIp.rows[0].n };
}

function logAttempt(eventId, attendeeId, ip, succeeded) {
  return pool.query(
    `INSERT INTO verification_attempts (event_id, attendee_id, ip_address, succeeded)
     VALUES ($1, $2, $3, $4)`,
    [eventId, attendeeId, ip, succeeded]
  ).catch(() => {}); // logging must never block a legitimate check-in
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  try {
    await initDB();

    if (req.method === 'PATCH') {
      const { attendee_id, code, method, contact } = req.body || {};
      if (!attendee_id) return res.status(400).json({ error: 'attendee_id required' });

      const token = getToken(req);
      const isAdmin = token ? !!verifyToken(token) : false;

      if (!isAdmin) {
        if (!code) return res.status(401).json({ error: 'Access code required' });
        const { rows: evRows } = await pool.query('SELECT access_code, kind FROM events WHERE id = $1', [id]);
        if (!evRows.length) return res.status(404).json({ error: 'Event not found' });
        const stored = (evRows[0].access_code || '').toUpperCase();
        if (!stored || stored !== code.trim().toUpperCase()) {
          return res.status(401).json({ error: 'Invalid access code' });
        }

        const { rows: check } = await pool.query(
          'SELECT * FROM attendees WHERE id = $1 AND event_id = $2',
          [attendee_id, id]
        );
        if (!check.length) return res.status(404).json({ error: 'Attendee not found' });
        const attendee = check[0];

        const hasPhone = !!(attendee.phone && attendee.phone.trim());
        const hasEmail = !!(attendee.email && attendee.email.trim());
        const ip = clientIp(req);

        // Anyone with a contact detail on file must prove it before checking in.
        if (hasPhone || hasEmail) {
          const fails = await recentFailures(id, attendee_id, ip);
          if (fails.attendee >= MAX_PER_ATTENDEE || fails.ip >= MAX_PER_IP) {
            return res.status(429).json({
              error: 'Too many failed attempts. Please wait 15 minutes or see the organiser.',
            });
          }

          if (!method || !contact) {
            return res.status(400).json({ error: 'Verification required' });
          }

          const result = checkContact(attendee, method, contact);
          if (result === 'unavailable') {
            return res.status(400).json({
              error: method === 'phone'
                ? 'No phone number on file for this person. Try email instead.'
                : 'No email address on file for this person. Try phone instead.',
            });
          }
          if (result !== 'ok') {
            await logAttempt(id, attendee_id, ip, false);
            const left = Math.max(0, MAX_PER_ATTENDEE - (fails.attendee + 1));
            return res.status(401).json({
              error: method === 'phone'
                ? "That phone number doesn't match our records."
                : "That email address doesn't match our records.",
              attempts_left: left,
            });
          }
          await logAttempt(id, attendee_id, ip, true);
        }

        // Attendance is recorded per day, so a multi-day event ticks the day the
        // person actually showed up rather than a single event-wide flag.
        await pool.query(
          `INSERT INTO attendance_days (attendee_id, event_id, day_date)
           VALUES ($1, $2, CURRENT_DATE)
           ON CONFLICT (attendee_id, day_date) DO NOTHING`,
          [attendee_id, id]
        );

        const { rows } = await pool.query(
          `UPDATE attendees
           SET attended = TRUE, attended_at = COALESCE(attended_at, NOW())
           WHERE id = $1 AND event_id = $2
           RETURNING id, name, attended`,
          [attendee_id, id]
        );

        const { rows: dayRows } = await pool.query(
          `SELECT day_date::text FROM attendance_days WHERE attendee_id = $1 ORDER BY day_date`,
          [attendee_id]
        );

        return res.status(200).json({
          ...rows[0],
          attended_today: true,
          attendance_days: dayRows.map(r => r.day_date),
          // AI Sprint participants continue to their personal Sprint page
          ...(evRows[0].kind === 'sprint' ? { portal_token: signPortalToken(rows[0].id) } : {}),
        });
      }

      // Admin: full toggle — per-day if day_date provided, otherwise legacy boolean toggle
      const { day_date } = req.body || {};

      if (day_date) {
        const { rows: existing } = await pool.query(
          `SELECT id FROM attendance_days WHERE attendee_id = $1 AND day_date = $2`,
          [attendee_id, day_date]
        );
        if (existing.length) {
          await pool.query(
            `DELETE FROM attendance_days WHERE attendee_id = $1 AND day_date = $2`,
            [attendee_id, day_date]
          );
        } else {
          await pool.query(
            `INSERT INTO attendance_days (attendee_id, event_id, day_date, attended_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (attendee_id, day_date) DO UPDATE SET attended_at = NOW()`,
            [attendee_id, id, day_date]
          );
        }
        const { rows: dayRows } = await pool.query(
          `SELECT day_date::text, attended_at FROM attendance_days WHERE attendee_id = $1 ORDER BY day_date`,
          [attendee_id]
        );
        const nowAttended = dayRows.length > 0;
        const latestAt = nowAttended
          ? dayRows.reduce((max, r) => (r.attended_at > max ? r.attended_at : max), dayRows[0].attended_at)
          : null;
        const { rows } = await pool.query(
          `UPDATE attendees SET attended = $2, attended_at = $3 WHERE id = $1 AND event_id = $4 RETURNING *`,
          [attendee_id, nowAttended, latestAt, id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Attendee not found' });
        return res.status(200).json({ ...rows[0], attendance_days: dayRows.map(r => r.day_date) });
      }

      // Legacy toggle (single-day events or All Days tab)
      const { rows } = await pool.query(
        `UPDATE attendees
         SET attended    = NOT attended,
             attended_at = CASE WHEN NOT attended THEN NOW() ELSE NULL END
         WHERE id = $1 AND event_id = $2
         RETURNING *`,
        [attendee_id, id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Attendee not found' });
      return res.status(200).json({ ...rows[0], attendance_days: [] });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
