// AI Sprint API. One function routes on ?action= to stay inside the
// serverless function limit.
//
// Admin (Bearer token):
//   GET    ?action=sessions           every Sprint session with attendance counts
//   GET    ?action=session&id=E       one session (by event id) and its content
//   PATCH  ?action=session&id=E       { assessment_url, playbook_url }
//   POST   ?action=resource           { event_id, kind, title, body, url, file_name, file_mime, file_base64 }
//   PATCH  ?action=resource&id=N      { title, body, url }
//   DELETE ?action=resource&id=N
// Participant (portal token from check-in, ?t=):
//   GET    ?action=portal             the participant's Sprint page
//   POST   ?action=assessment         { attendee_id } records that the assessment was opened
// Either:
//   GET    ?action=file&id=N          download an uploaded asset

const { pool, initDB } = require('./_db');
const { requireAuth, getToken, verifyToken, verifyPortalToken } = require('./_auth');

const MAX_FILE_BYTES = 3 * 1024 * 1024; // keeps the upload under the 4.5 MB request limit
const KINDS = ['prompt', 'link', 'file'];

const RESOURCE_COLS = `id, event_id, kind, title, body, url, file_name, file_mime,
  (file_data IS NOT NULL) AS has_file, COALESCE(OCTET_LENGTH(file_data), 0)::int AS file_size, created_at`;

function cleanUrl(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return 'https://' + s;
  return s;
}

// All Sprint attendee rows that belong to the same person as the token's row:
// the row itself plus any other attended Sprint session registered with the
// same phone number or email address.
async function personSessions(attendeeId) {
  const { rows } = await pool.query(
    `WITH me AS (SELECT id, phone, email FROM attendees WHERE id = $1)
     SELECT a.id AS attendee_id, a.name, a.attended, a.assessment_opened_at,
            e.id AS event_id, e.name AS event_name, e.start_date::text AS date, e.session_time,
            e.week_no, e.delivery_mode, e.track_key, e.assessment_url, e.playbook_url,
            t.title AS track_title, t.time_label
     FROM attendees a
     JOIN events e ON e.id = a.event_id AND e.kind = 'sprint'
     LEFT JOIN sprint_tracks t ON t.key = e.track_key
     CROSS JOIN me
     WHERE a.id = me.id
        OR (a.attended AND (
              (me.phone IS NOT NULL AND me.phone <> '' AND a.phone = me.phone)
           OR (me.email IS NOT NULL AND me.email <> '' AND LOWER(a.email) = LOWER(me.email))
        ))
     ORDER BY e.start_date DESC, e.session_time DESC`,
    [attendeeId]
  );
  return rows;
}

function portalAuth(req, res) {
  const t = req.query.t || (req.body && req.body.t);
  const p = t ? verifyPortalToken(String(t)) : null;
  if (!p) { res.status(401).json({ error: 'This link has expired. Please check in again to get a new one.' }); return null; }
  return p;
}

module.exports = async (req, res) => {
  const { action } = req.query;

  try {
    await initDB();

    /* ── FILE DOWNLOAD (admin or participant) ── */
    if (action === 'file' && req.method === 'GET') {
      const { rows } = await pool.query(
        'SELECT event_id, file_name, file_mime, file_data FROM sprint_resources WHERE id = $1 AND file_data IS NOT NULL',
        [req.query.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'File not found' });
      const file = rows[0];

      const adminTok = getToken(req) || req.query.t;
      let allowed = !!(adminTok && verifyToken(String(adminTok)));
      if (!allowed && req.query.t) {
        const p = verifyPortalToken(String(req.query.t));
        if (p) allowed = (await personSessions(p.aid)).some(s => s.event_id === file.event_id);
      }
      if (!allowed) return res.status(401).json({ error: 'Unauthorized' });

      const safeName = String(file.file_name || 'file').replace(/["\r\n]/g, '');
      res.setHeader('Content-Type', file.file_mime || 'application/octet-stream');
      res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${safeName}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(200).send(file.file_data);
    }

    res.setHeader('Content-Type', 'application/json');

    /* ── PARTICIPANT ── */
    if (action === 'portal' && req.method === 'GET') {
      const p = portalAuth(req, res);
      if (!p) return;
      const sessions = await personSessions(p.aid);
      const current = sessions.find(s => s.attendee_id === p.aid);
      if (!current) return res.status(404).json({ error: 'Participant not found' });

      const { rows: resources } = await pool.query(
        `SELECT ${RESOURCE_COLS} FROM sprint_resources WHERE event_id = ANY($1) ORDER BY sort_order, id`,
        [sessions.map(s => s.event_id)]
      );

      return res.status(200).json({
        name: current.name,
        current_attendee_id: p.aid,
        sessions: sessions.map(s => ({
          attendee_id: s.attendee_id,
          event_name: s.event_name,
          date: s.date,
          time: s.session_time,
          week: s.week_no,
          mode: s.delivery_mode,
          track_key: s.track_key,
          title: s.track_title || s.event_name,
          time_label: s.time_label,
          assessment_url: s.assessment_url,
          playbook_url: s.playbook_url,
          resources: resources.filter(r => r.event_id === s.event_id),
          assessment_opened: !!s.assessment_opened_at,
        })),
      });
    }

    if (action === 'assessment' && req.method === 'POST') {
      const p = portalAuth(req, res);
      if (!p) return;
      const target = Number((req.body || {}).attendee_id) || p.aid;
      const sessions = await personSessions(p.aid);
      if (!sessions.some(s => s.attendee_id === target)) return res.status(403).json({ error: 'Not your session' });
      await pool.query(
        'UPDATE attendees SET assessment_opened_at = COALESCE(assessment_opened_at, NOW()) WHERE id = $1',
        [target]
      );
      return res.status(200).json({ ok: true });
    }

    /* ── ADMIN ── */
    const admin = requireAuth(req, res);
    if (!admin) return;

    if (action === 'sessions' && req.method === 'GET') {
      const { rows } = await pool.query(`
        SELECT e.id, e.name, e.slug, e.access_code, e.start_date::text AS date, e.session_time, e.week_no,
               e.delivery_mode, e.track_key, e.facilitator_in_person, e.facilitator_virtual, e.facilitator_support,
               e.assessment_url, e.playbook_url,
               (SELECT COUNT(*) FROM sprint_resources r WHERE r.event_id = e.id)::int AS resource_count,
               t.title AS track_title, t.time_label,
               COUNT(a.id)::int AS total_attendees,
               COUNT(a.id) FILTER (WHERE a.attended)::int AS attended_count,
               COUNT(a.id) FILTER (WHERE a.assessment_opened_at IS NOT NULL)::int AS assessment_count
        FROM events e
        LEFT JOIN sprint_tracks t ON t.key = e.track_key
        LEFT JOIN attendees a ON a.event_id = e.id
        WHERE e.kind = 'sprint'
        GROUP BY e.id, t.title, t.time_label
        ORDER BY e.start_date, e.session_time
      `);
      return res.status(200).json(rows);
    }

    if (action === 'session') {
      const id = Number(req.query.id);
      if (req.method === 'GET') {
        const { rows } = await pool.query(
          `SELECT e.id, e.name, e.slug, e.access_code, e.start_date::text AS date, e.session_time, e.week_no,
                  e.delivery_mode, e.track_key, e.facilitator_in_person, e.facilitator_virtual, e.facilitator_support,
                  e.assessment_url, e.playbook_url, t.title AS track_title, t.time_label
           FROM events e LEFT JOIN sprint_tracks t ON t.key = e.track_key
           WHERE e.id = $1 AND e.kind = 'sprint'`, [id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Session not found' });
        const { rows: resources } = await pool.query(
          `SELECT ${RESOURCE_COLS} FROM sprint_resources WHERE event_id = $1 ORDER BY sort_order, id`, [id]
        );
        return res.status(200).json({ ...rows[0], resources });
      }
      if (req.method === 'PATCH') {
        const b = req.body || {};
        const { rows } = await pool.query(
          `UPDATE events SET assessment_url = $2, playbook_url = $3
           WHERE id = $1 AND kind = 'sprint' RETURNING id, assessment_url, playbook_url`,
          [id, cleanUrl(b.assessment_url), cleanUrl(b.playbook_url)]
        );
        if (!rows.length) return res.status(404).json({ error: 'Session not found' });
        return res.status(200).json(rows[0]);
      }
    }

    if (action === 'resource') {
      if (req.method === 'POST') {
        const b = req.body || {};
        const kind = String(b.kind || '');
        const title = String(b.title || '').trim();
        if (!KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be prompt, link or file' });
        if (!title) return res.status(400).json({ error: 'Title is required' });

        let data = null;
        if (kind === 'prompt' && !String(b.body || '').trim()) return res.status(400).json({ error: 'Prompt text is required' });
        if (kind === 'link' && !cleanUrl(b.url)) return res.status(400).json({ error: 'Link URL is required' });
        if (kind === 'file') {
          if (!b.file_base64) return res.status(400).json({ error: 'Choose a file to upload' });
          data = Buffer.from(String(b.file_base64), 'base64');
          if (!data.length) return res.status(400).json({ error: 'File is empty' });
          if (data.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'File is larger than 3 MB — share it as a link instead' });
        }

        const { rows: next } = await pool.query(
          'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM sprint_resources WHERE event_id = $1', [b.event_id]
        );
        const { rows } = await pool.query(
          `INSERT INTO sprint_resources (event_id, track_key, kind, title, body, url, file_name, file_mime, file_data, sort_order)
           SELECT e.id, e.track_key, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::bytea, $9::int FROM events e WHERE e.id = $1 AND e.kind = 'sprint'
           RETURNING ${RESOURCE_COLS}`,
          [Number(b.event_id), kind, title, String(b.body || '').trim() || null, kind === 'link' ? cleanUrl(b.url) : null,
           kind === 'file' ? String(b.file_name || 'file').slice(0, 255) : null,
           kind === 'file' ? String(b.file_mime || 'application/octet-stream').slice(0, 100) : null,
           data, next[0].n]
        );
        if (!rows.length) return res.status(404).json({ error: 'Session not found' });
        return res.status(201).json(rows[0]);
      }
      if (req.method === 'PATCH') {
        const b = req.body || {};
        const { rows } = await pool.query(
          `UPDATE sprint_resources
           SET title = COALESCE(NULLIF($2, ''), title), body = $3,
               url = CASE WHEN kind = 'link' THEN COALESCE($4, url) ELSE url END
           WHERE id = $1 RETURNING ${RESOURCE_COLS}`,
          [req.query.id, String(b.title || '').trim(), String(b.body || '').trim() || null, cleanUrl(b.url)]
        );
        if (!rows.length) return res.status(404).json({ error: 'Resource not found' });
        return res.status(200).json(rows[0]);
      }
      if (req.method === 'DELETE') {
        await pool.query('DELETE FROM sprint_resources WHERE id = $1', [req.query.id]);
        return res.status(200).json({ ok: true });
      }
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Unknown Sprint session' });
    res.status(500).json({ error: err.message });
  }
};
