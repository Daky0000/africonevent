const { pool, initDB } = require('../../_db');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  try {
    await initDB();

    if (req.method === 'PATCH') {
      const { attendee_id } = req.body || {};
      if (!attendee_id) return res.status(400).json({ error: 'attendee_id required' });

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
