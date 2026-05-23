const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

let initialized = false;

async function initDB() {
  if (initialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(255) NOT NULL,
      username      VARCHAR(100) NOT NULL UNIQUE,
      email         VARCHAR(255) UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS username VARCHAR(100) UNIQUE
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      description TEXT,
      start_date  DATE NOT NULL,
      end_date    DATE,
      slug        VARCHAR(100) NOT NULL UNIQUE,
      created_by  INTEGER REFERENCES admins(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'event_date') THEN
        ALTER TABLE events RENAME COLUMN event_date TO start_date;
      END IF;
    END $$;
  `);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS end_date DATE`);

  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS access_code VARCHAR(20)`);
  // Backfill any existing events that don't have a code yet
  await pool.query(`
    UPDATE events
    SET access_code = UPPER(SUBSTRING(MD5(id::TEXT || random()::TEXT), 1, 6))
    WHERE access_code IS NULL
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'attendees'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'attendees' AND column_name = 'event_id'
      ) THEN
        DROP TABLE attendees;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendees (
      id          SERIAL PRIMARY KEY,
      event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name        VARCHAR(255) NOT NULL,
      phone       VARCHAR(50),
      email       VARCHAR(255),
      attended    BOOLEAN NOT NULL DEFAULT FALSE,
      attended_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_ips (
      id          SERIAL PRIMARY KEY,
      event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      ip_address  VARCHAR(45) NOT NULL,
      attendee_id INTEGER REFERENCES attendees(id) ON DELETE SET NULL,
      marked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_id, ip_address)
    )
  `);

  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('Africon@i', 10);
  await pool.query(
    `INSERT INTO admins (name, username, email, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO NOTHING`,
    ['Africon', 'Africon', 'africon@africon.com', hash]
  );

  initialized = true;
}

module.exports = { pool, initDB };
