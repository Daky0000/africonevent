const { pool, initDB } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    await initDB();

    if (req.method === 'PATCH') {
      const { id } = req.body || {};
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }
      const { rows } = await pool.query(
        'UPDATE attendees SET attended = NOT attended WHERE id = $1 RETURNING *',
        [id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Attendee not found' });
      }
      return res.status(200).json(rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
