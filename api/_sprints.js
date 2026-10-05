// AI Sprint programme: the nine Sprint tracks and the 2026 facilitator timetable.
// Every session is stored as an event row (kind = 'sprint') so the existing
// attendee import, access code and check-in flow work for it unchanged.

const TRACKS = [
  { key: 'scribe',     title: 'Prompt Foundation — SCRIBE',   day: 0, time: '09:00', label: '9–11 am' },
  { key: 'chatgpt',    title: 'ChatGPT, Inside Out',          day: 0, time: '12:00', label: '12–2 pm' },
  { key: 'claude',     title: 'Claude, Inside Out',           day: 0, time: '15:00', label: '3–5 pm' },
  { key: 'crit',       title: 'Prompt Intermediate — CRIT',   day: 1, time: '09:00', label: '9–11 am' },
  { key: 'notebooklm', title: 'NotebookLM, Inside Out',       day: 1, time: '12:00', label: '12–2 pm' },
  { key: 'gamma',      title: 'Gamma, Inside Out',            day: 1, time: '15:00', label: '3–5 pm' },
  { key: 'readai',     title: 'Read AI, Inside Out',          day: 2, time: '09:00', label: '9–11 am' },
  { key: 'gemini',     title: 'Gemini, Inside Out',           day: 2, time: '12:00', label: '12–2 pm' },
  { key: 'ethics',     title: 'AI Governance & Ethics',       day: 2, time: '15:00', label: '3–5 pm' },
];

// [in-person, virtual] per track, in TRACKS order. null = no in-person room.
const WEEK1 = [
  ['Nadiet', 'Martin'], ['Martin', 'Nadiet'], ['Dan', 'Martin'],
  ['Oscar', 'Nadiet'],  ['Oscar', 'Martin'],  ['Nadiet', 'Martin'],
  ['Oscar', 'Dan'],     ['Dan', 'Martin'],    [null, 'Oscar'],
];
const WEEK2 = [
  ['Martin', 'Oscar'],  ['Martin', 'Dan'],    ['Dan', 'Martin'],
  ['Oscar', 'Nadiet'],  ['Oscar', 'Martin'],  ['Martin', 'Dan'],
  ['Oscar', 'Dan'],     ['Martin', 'Dan'],    [null, 'Oscar'],
];
const PATTERN_A = [ // Week 3
  ['Dan', 'Nadiet'],    ['Martin', 'Nadiet'], ['Dan', 'Martin'],
  ['Gideon', 'Oscar'],  ['Nadiet', 'Dan'],    ['Martin', 'Nadiet'],
  ['Oscar', 'Dan'],     ['Dan', 'Martin'],    ['Gideon', 'Oscar'],
];
const PATTERN_B = [ // Week 4
  ['Nadiet', 'Gideon'], ['Dan', 'Martin'],    ['Oscar', 'Dan'],
  ['Oscar', 'Gideon'],  ['Gideon', 'Oscar'],  ['Martin', 'Nadiet'],
  ['Dan', 'Oscar'],     ['Martin', 'Dan'],    [null, 'Gideon'],
];
// Week 12 is online only: [online lead, online support]
const WEEK12 = [
  ['Nadiet', 'Gideon'], ['Martin', 'Dan'],    ['Dan', 'Oscar'],
  ['Gideon', 'Oscar'],  ['Oscar', 'Martin'],  ['Martin', 'Nadiet'],
  ['Oscar', 'Dan'],     ['Dan', 'Martin'],    ['Gideon', 'Oscar'],
];

const WEEK1_TUESDAY = '2026-10-06';

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function weekPlan(week) {
  if (week === 1) return WEEK1;
  if (week === 2) return WEEK2;
  if (week === 12) return WEEK12;
  return week % 2 === 1 ? PATTERN_A : PATTERN_B; // 3,5,7,9,11 = A; 4,6,8,10 = B
}

function buildSessions() {
  const sessions = [];
  for (let week = 1; week <= 12; week++) {
    const tuesday = addDays(WEEK1_TUESDAY, (week - 1) * 7);
    const plan = weekPlan(week);
    const online = week === 12;
    TRACKS.forEach((t, i) => {
      const date = addDays(tuesday, t.day);
      const [a, b] = plan[i];
      sessions.push({
        week,
        track_key: t.key,
        date,
        time: t.time,
        name: `${t.title} · ${fmtShort(date)}`,
        slug: `sprint-${date}-${t.key}`,
        mode: online ? 'online' : (a ? 'hybrid' : 'virtual'),
        in_person: online ? null : a,
        virtual: online ? a : b,
        support: online ? b : null,
      });
    });
  }
  return sessions;
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function migrateSprints(pool) {
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'masterclass'`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS track_key VARCHAR(40)`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS week_no INTEGER`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS session_time VARCHAR(5)`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(20)`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS facilitator_in_person VARCHAR(100)`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS facilitator_virtual VARCHAR(100)`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS facilitator_support VARCHAR(100)`);

  await pool.query(`ALTER TABLE attendees ADD COLUMN IF NOT EXISTS assessment_opened_at TIMESTAMPTZ`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sprint_tracks (
      key            VARCHAR(40) PRIMARY KEY,
      title          VARCHAR(255) NOT NULL,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      time_label     VARCHAR(40),
      assessment_url TEXT,
      playbook_url   TEXT,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sprint_resources (
      id          SERIAL PRIMARY KEY,
      track_key   VARCHAR(40) NOT NULL REFERENCES sprint_tracks(key) ON DELETE CASCADE,
      kind        VARCHAR(20) NOT NULL,          -- prompt | link | file
      title       VARCHAR(255) NOT NULL,
      body        TEXT,                          -- prompt text or note
      url         TEXT,                          -- external link
      file_name   VARCHAR(255),
      file_mime   VARCHAR(100),
      file_data   BYTEA,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Content is managed per session (date), not per Sprint track
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS assessment_url TEXT`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS playbook_url TEXT`);
  await pool.query(`ALTER TABLE sprint_resources ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE sprint_resources ALTER COLUMN track_key DROP NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sprint_resources_event ON sprint_resources (event_id)`);

  for (let i = 0; i < TRACKS.length; i++) {
    const t = TRACKS[i];
    await pool.query(
      `INSERT INTO sprint_tracks (key, title, sort_order, time_label) VALUES ($1,$2,$3,$4)
       ON CONFLICT (key) DO NOTHING`,
      [t.key, t.title, i, t.label]
    );
  }

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM events WHERE kind = 'sprint'`);
  const sessions = buildSessions();
  if (rows[0].n >= sessions.length) return;

  for (const s of sessions) {
    await pool.query(
      `INSERT INTO events (name, start_date, end_date, slug, access_code, kind, track_key, week_no,
                           session_time, delivery_mode, facilitator_in_person, facilitator_virtual, facilitator_support)
       VALUES ($1,$2,$2,$3,$4,'sprint',$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (slug) DO NOTHING`,
      [s.name, s.date, s.slug, generateCode(), s.track_key, s.week, s.time, s.mode, s.in_person, s.virtual, s.support]
    );
  }
}

module.exports = { TRACKS, buildSessions, migrateSprints };
