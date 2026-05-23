const { pool, initDB } = require('../../_db');

function getClientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDB();
    const ip = getClientIP(req);
    const { rows } = await pool.query(
      `SELECT ai.ip_address, a.name
       FROM attendance_ips ai
       LEFT JOIN attendees a ON a.id = ai.attendee_id
       WHERE ai.event_id = $1 AND ai.ip_address = $2`,
      [id, ip]
    );
    if (rows.length) {
      return res.status(200).json({ marked: true, name: rows[0].name });
    }
    return res.status(200).json({ marked: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
