const { pool, initDB } = require('../../_db');
const { requireAuth } = require('../../_auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const payload = requireAuth(req, res);
  if (!payload) return;
  const { id } = req.query;

  try {
    await initDB();
    const [evtRes, attRes] = await Promise.all([
      pool.query('SELECT * FROM events WHERE id = $1', [id]),
      pool.query('SELECT * FROM attendees WHERE event_id = $1 ORDER BY name ASC', [id]),
    ]);
    if (!evtRes.rows.length) return res.status(404).json({ error: 'Event not found' });

    const event = evtRes.rows[0];
    const attendees = attRes.rows;
    const total = attendees.length;
    const attended = attendees.filter(a => a.attended).length;

    res.status(200).json({
      event,
      stats: {
        total,
        attended,
        not_attended: total - attended,
        rate: total === 0 ? 0 : Math.round((attended / total) * 100),
      },
      attendees,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
