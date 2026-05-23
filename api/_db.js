const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

let initialized = false;

const INITIAL_ATTENDEES = [
  ['Nicholas Yao Gakpetor', '0242246138'],
  ['Solomon Sappor', '+233268727284'],
  ['Nick Bossah', '+233545922261'],
  ['Andrew Tetteh', '+233243571210'],
  ['Stephen Owusu-Duah', '0544111131'],
  ['Jonas Yao Korto', '0243302779'],
  ['Savior Ewatey', '0262593173'],
  ['Therestella Aidoo', '0504549553'],
  ['Gordon Dodoo', '+233245425735'],
  ['Lawrence Nanor', '+233262406104'],
  ['Cornelius Ohene Basewah', '+233541538847'],
  ['Armah Emmanuel', '+233243366441'],
  ['Gilceilder Yaa Yeboah', '+233206959633'],
  ['Nathaniel Fiifi Nsafoah', '0209609598'],
  ['Edward Bosomtwe Eshun', '0202030065'],
  ['Nana Kwame Ayeh', '+233242637137'],
  ['Sebastian Besa Gadah', '0241704385'],
  ['Philip Isaac Adubeng', '0559052945'],
  ['Raymond Mills', '0200196327'],
  ['Grace Awotwe', '0244436680'],
  ['Lois Appiah', '+233244576998'],
  ['Felix Afari', '+233244985318'],
];

async function initDB() {
  if (initialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendees (
      id        SERIAL PRIMARY KEY,
      name      VARCHAR(255) NOT NULL,
      phone     VARCHAR(50)  NOT NULL,
      attended  BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM attendees');
  if (parseInt(rows[0].count, 10) === 0) {
    for (const [name, phone] of INITIAL_ATTENDEES) {
      await pool.query(
        'INSERT INTO attendees (name, phone) VALUES ($1, $2)',
        [name, phone]
      );
    }
  }

  initialized = true;
}

module.exports = { pool, initDB };
