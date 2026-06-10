const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Reset-Secret,X-Import-Secret'
};

const CHAT_LIMIT = 80;
const CHAT_MAX_LENGTH = 260;
const ONLINE_WINDOW_MS = 90000;
const CHAT_OPENER_AUTHOR = 'Käsino-Croupier';
const CHAT_OPENER_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CHAT_OPENERS = [
  'Was ist euer Lieblingskäse?',
  'Wie mögt ihr euren Obatzda am liebsten?',
  'Wer ist euer Zweitlieblingsoligarch?',
  'Welcher Käse ist massiv unterschätzt?',
  'Was ist der perfekte Snack zum Käsino?',
  'Welche Oligarchenstrategie fährt ihr heute?'
];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    week_start TEXT NOT NULL,
    name TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 100,
    best_coins INTEGER NOT NULL DEFAULT 100,
    best_single_win INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (week_start, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_players_week_best_coins
    ON players (week_start, best_coins DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_players_week_best_single_win
    ON players (week_start, best_single_win DESC)`,
  `CREATE TABLE IF NOT EXISTS weekly_champions (
    week_start TEXT PRIMARY KEY,
    week_label TEXT NOT NULL,
    winner_name TEXT,
    winner_score INTEGER,
    biggest_win_name TEXT,
    biggest_win_score INTEGER,
    archived_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start TEXT NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_week_id
    ON chat_messages (week_start, id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_croupier_slot
    ON chat_messages (week_start, created_at)
    WHERE name = 'Käsino-Croupier'`,
  `CREATE TABLE IF NOT EXISTS online_presence (
    week_start TEXT NOT NULL,
    name TEXT NOT NULL,
    last_seen INTEGER NOT NULL,
    PRIMARY KEY (week_start, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_online_presence_week_seen
    ON online_presence (week_start, last_seen DESC)`
];

let schemaReady = false;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        return json({ ok: false, error: error.message || String(error) }, 500);
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Käsino asset binding missing.', { status: 500 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(resetIfNeeded(env.DB, new Date(), true));
  }
};

async function handleApi(request, env, url) {
  if (!env.DB) return json({ ok: false, error: 'D1 binding DB fehlt.' }, 500);
  await ensureCurrentWeek(env.DB);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const weekStart = await getMeta(env.DB, 'week_start');
    return json({ ok: true, weekStart });
  }

  if (request.method === 'GET' && url.pathname === '/api/state') {
    const name = cleanName(url.searchParams.get('name') || '');
    return json(await buildState(env.DB, name));
  }

  if (request.method === 'PUT' && url.pathname === '/api/player') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    await upsertPlayer(env.DB, {
      name,
      credits: toInt(payload.credits, 100),
      bestCoins: toInt(payload.credits, 100),
      bestSingleWin: 0,
      updatedAt: toInt(payload.updatedAt, Date.now())
    });
    return json(await buildState(env.DB, name));
  }

  if (request.method === 'POST' && url.pathname === '/api/leaderboard') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    const playerCredits = payload.player && Number.isFinite(Number(payload.player.credits))
      ? payload.player.credits
      : payload.totalCoins;
    await upsertPlayer(env.DB, {
      name,
      credits: toInt(playerCredits, 100),
      bestCoins: toInt(payload.totalCoins, 100),
      bestSingleWin: toInt(payload.singleWin, 0),
      updatedAt: payload.player?.updatedAt ? toInt(payload.player.updatedAt, Date.now()) : Date.now()
    });
    return json(await buildState(env.DB, name));
  }

  if (request.method === 'GET' && url.pathname === '/api/chat') {
    const weekStart = await ensureCurrentWeek(env.DB);
    const after = Math.max(0, toInt(url.searchParams.get('after'), 0));
    const opener = await ensureChatOpener(env.DB, weekStart);
    return json({
      ok: true,
      weekStart,
      currentOpener: opener.body,
      messages: await getChatMessages(env.DB, weekStart, after),
      online: await getOnlinePlayers(env.DB, weekStart)
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/chat') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    const body = cleanChatBody(payload.body);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    if (name === CHAT_OPENER_AUTHOR) return json({ ok: false, error: 'Dieser Chatname ist reserviert.' }, 400);
    if (!body) return json({ ok: false, error: 'Nachricht fehlt.' }, 400);
    const weekStart = await ensureCurrentWeek(env.DB);
    const opener = await ensureChatOpener(env.DB, weekStart);
    await updatePresence(env.DB, weekStart, name);
    const message = await insertChatMessage(env.DB, weekStart, name, body);
    return json({
      ok: true,
      weekStart,
      currentOpener: opener.body,
      message,
      messages: [message],
      online: await getOnlinePlayers(env.DB, weekStart)
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/presence') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    const weekStart = await ensureCurrentWeek(env.DB);
    await updatePresence(env.DB, weekStart, name);
    return json({
      ok: true,
      weekStart,
      online: await getOnlinePlayers(env.DB, weekStart)
    });
  }

  if ((request.method === 'POST' || request.method === 'GET')
      && (url.pathname === '/api/weekly-reset' || url.pathname === '/api/reset')) {
    if (env.RESET_SECRET && request.headers.get('X-Reset-Secret') !== env.RESET_SECRET) {
      return json({ ok: false, error: 'Reset secret fehlt.' }, 401);
    }
    return json(await resetIfNeeded(env.DB, new Date(), false));
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/import-jsonbin') {
    const secret = env.IMPORT_SECRET || env.RESET_SECRET;
    if (!secret || request.headers.get('X-Import-Secret') !== secret) {
      return json({ ok: false, error: 'Import secret fehlt.' }, 401);
    }
    const payload = await request.json();
    return json(await importJsonbinRecord(env.DB, payload));
  }

  return json({ ok: false, error: 'Route nicht gefunden.' }, 404);
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(sql => db.prepare(sql)));
  schemaReady = true;
}

async function ensureCurrentWeek(db, date = new Date()) {
  await ensureSchema(db);
  const currentWeek = getWeekStart(date);
  const storedWeek = await getMeta(db, 'week_start');
  if (!storedWeek) {
    await setMeta(db, 'week_start', currentWeek);
    await setMeta(db, 'reset_epoch', `${currentWeek}-${Date.now()}`);
    return currentWeek;
  }
  if (storedWeek !== currentWeek) await archiveAndReset(db, storedWeek, currentWeek);
  return currentWeek;
}

async function resetIfNeeded(db, date = new Date(), fromCron = false) {
  await ensureSchema(db);
  const beforeWeek = await getMeta(db, 'week_start');
  const currentWeek = await ensureCurrentWeek(db, date);
  const resetEpoch = await getMeta(db, 'reset_epoch');
  return {
    ok: true,
    changed: !!beforeWeek && beforeWeek !== currentWeek,
    fromCron,
    weekStart: currentWeek,
    resetEpoch,
    leaderboard: await buildLeaderboard(db, currentWeek)
  };
}

async function archiveAndReset(db, oldWeek, currentWeek) {
  const topCoins = await db.prepare(
    `SELECT name, best_coins AS score
     FROM players
     WHERE week_start = ? AND best_coins > 0
     ORDER BY best_coins DESC, updated_at ASC
     LIMIT 1`
  ).bind(oldWeek).first();

  const topWin = await db.prepare(
    `SELECT name, best_single_win AS score
     FROM players
     WHERE week_start = ? AND best_single_win > 0
     ORDER BY best_single_win DESC, updated_at ASC
     LIMIT 1`
  ).bind(oldWeek).first();

  if (topCoins || topWin) {
    await db.prepare(
      `INSERT OR REPLACE INTO weekly_champions
        (week_start, week_label, winner_name, winner_score, biggest_win_name, biggest_win_score, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      oldWeek,
      weekLabel(oldWeek),
      topCoins?.name || null,
      topCoins?.score || null,
      topWin?.name || null,
      topWin?.score || null,
      Date.now()
    ).run();
  }

  await db.batch([
    db.prepare('DELETE FROM players WHERE week_start <> ?').bind(currentWeek),
    db.prepare('DELETE FROM chat_messages WHERE week_start <> ?').bind(currentWeek),
    db.prepare('DELETE FROM online_presence WHERE week_start <> ?').bind(currentWeek),
    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('week_start', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(currentWeek),
    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('reset_epoch', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(`${currentWeek}-${Date.now()}`)
  ]);
}

async function upsertPlayer(db, entry) {
  const weekStart = await ensureCurrentWeek(db);
  const now = Date.now();
  const updatedAt = Math.max(0, Number(entry.updatedAt || now));
  const credits = Math.max(0, Math.floor(Number(entry.credits || 0)));
  const bestCoins = Math.max(credits, Math.floor(Number(entry.bestCoins || 0)));
  const bestSingleWin = Math.max(0, Math.floor(Number(entry.bestSingleWin || 0)));

  await db.prepare(
    `INSERT INTO players
      (week_start, name, credits, best_coins, best_single_win, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(week_start, name) DO UPDATE SET
       credits = CASE
         WHEN excluded.updated_at >= players.updated_at THEN excluded.credits
         ELSE players.credits
       END,
       best_coins = max(players.best_coins, excluded.best_coins, excluded.credits),
       best_single_win = max(players.best_single_win, excluded.best_single_win),
       updated_at = max(players.updated_at, excluded.updated_at)`
  ).bind(weekStart, entry.name, credits, bestCoins, bestSingleWin, updatedAt).run();
}

async function importJsonbinRecord(db, raw) {
  await ensureSchema(db);
  const currentWeek = getWeekStart();
  const sourceWeek = raw?.weekStart || currentWeek;
  const sourceIsCurrentWeek = sourceWeek === currentWeek;

  if (raw?.lastWeek) await importChampion(db, raw.lastWeek);

  if (!sourceIsCurrentWeek) {
    await archiveImportedWeek(db, raw, sourceWeek);
    await setMeta(db, 'week_start', currentWeek);
    await setMeta(db, 'reset_epoch', `${currentWeek}-${Date.now()}`);
    return { ok: true, imported: 'archived-week', weekStart: currentWeek, leaderboard: await buildLeaderboard(db, currentWeek) };
  }

  await setMeta(db, 'week_start', currentWeek);
  await setMeta(db, 'reset_epoch', raw.resetEpoch || `${currentWeek}-${Date.now()}`);

  const byName = new Map();
  for (const row of raw.coins || []) {
    const name = cleanName(row.name);
    if (!name) continue;
    const score = toInt(row.score, 0);
    const entry = byName.get(name) || { bestCoins: 100, bestSingleWin: 0, credits: 100 };
    entry.bestCoins = Math.max(entry.bestCoins, score);
    entry.credits = Math.max(entry.credits, score);
    byName.set(name, entry);
  }
  for (const row of raw.wins || []) {
    const name = cleanName(row.name);
    if (!name) continue;
    const score = toInt(row.score, 0);
    const entry = byName.get(name) || { bestCoins: 100, bestSingleWin: 0, credits: 100 };
    entry.bestSingleWin = Math.max(entry.bestSingleWin, score);
    entry.bestCoins = Math.max(entry.bestCoins, score);
    entry.credits = Math.max(entry.credits, score);
    byName.set(name, entry);
  }

  const now = Date.now();
  const statements = [];
  for (const [name, entry] of byName) {
    statements.push(db.prepare(
      `INSERT INTO players
        (week_start, name, credits, best_coins, best_single_win, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(week_start, name) DO UPDATE SET
         credits = max(players.credits, excluded.credits),
         best_coins = max(players.best_coins, excluded.best_coins),
         best_single_win = max(players.best_single_win, excluded.best_single_win),
         updated_at = max(players.updated_at, excluded.updated_at)`
    ).bind(currentWeek, name, entry.credits, entry.bestCoins, entry.bestSingleWin, now));
  }
  if (statements.length) await db.batch(statements);

  return {
    ok: true,
    imported: statements.length,
    weekStart: currentWeek,
    leaderboard: await buildLeaderboard(db, currentWeek)
  };
}

async function archiveImportedWeek(db, raw, weekStart) {
  const winner = Array.isArray(raw?.coins) && raw.coins.length ? raw.coins[0] : null;
  const biggestWin = Array.isArray(raw?.wins) && raw.wins.length ? raw.wins[0] : null;
  if (!winner && !biggestWin) return;
  await importChampion(db, {
    weekStart,
    weekLabel: raw.weekLabel || weekLabel(weekStart),
    winner,
    biggestWin
  });
}

async function importChampion(db, raw) {
  if (!raw || typeof raw !== 'object') return;
  const weekStart = raw.weekStart;
  if (!weekStart) return;
  await db.prepare(
    `INSERT OR REPLACE INTO weekly_champions
      (week_start, week_label, winner_name, winner_score, biggest_win_name, biggest_win_score, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    weekStart,
    raw.weekLabel || weekLabel(weekStart),
    raw.winner?.name || null,
    raw.winner ? toInt(raw.winner.score, 0) : null,
    raw.biggestWin?.name || null,
    raw.biggestWin ? toInt(raw.biggestWin.score, 0) : null,
    Date.now()
  ).run();
}

async function buildState(db, name = '') {
  const currentWeek = await ensureCurrentWeek(db);
  return {
    ok: true,
    leaderboard: await buildLeaderboard(db, currentWeek),
    player: name ? await getPlayer(db, currentWeek, name) : null
  };
}

async function buildLeaderboard(db, weekStart) {
  const resetEpoch = await getMeta(db, 'reset_epoch') || '';
  const coins = await db.prepare(
    `SELECT name, best_coins AS score
     FROM players
     WHERE week_start = ?
     ORDER BY best_coins DESC, updated_at ASC
     LIMIT 10`
  ).bind(weekStart).all();

  const wins = await db.prepare(
    `SELECT name, best_single_win AS score
     FROM players
     WHERE week_start = ? AND best_single_win > 0
     ORDER BY best_single_win DESC, updated_at ASC
     LIMIT 10`
  ).bind(weekStart).all();

  return {
    weekStart,
    resetEpoch,
    coins: (coins.results || []).map(row => ({ name: row.name, score: Number(row.score || 0) })),
    wins: (wins.results || []).map(row => ({ name: row.name, score: Number(row.score || 0) })),
    lastWeek: await getChampion(db, previousWeekStartFromKey(weekStart))
  };
}

async function getChatMessages(db, weekStart, after = 0) {
  const rows = await db.prepare(
    `SELECT id, name, body, created_at AS createdAt
     FROM chat_messages
     WHERE week_start = ? AND id > ?
     ORDER BY id ASC
     LIMIT ?`
  ).bind(weekStart, after, CHAT_LIMIT).all();
  return (rows.results || []).map(row => ({
    id: Number(row.id || 0),
    name: row.name,
    body: row.body,
    createdAt: Number(row.createdAt || 0)
  }));
}

async function ensureChatOpener(db, weekStart) {
  const now = Date.now();
  const slotStart = Math.floor(now / CHAT_OPENER_INTERVAL_MS) * CHAT_OPENER_INTERVAL_MS;
  const body = CHAT_OPENERS[Math.floor(now / CHAT_OPENER_INTERVAL_MS) % CHAT_OPENERS.length];

  await db.prepare(
    `INSERT OR IGNORE INTO chat_messages (week_start, name, body, created_at)
     VALUES (?, ?, ?, ?)`
  ).bind(weekStart, CHAT_OPENER_AUTHOR, body, slotStart).run();

  const row = await db.prepare(
    `SELECT id, name, body, created_at AS createdAt
     FROM chat_messages
     WHERE week_start = ? AND name = ? AND created_at = ?
     LIMIT 1`
  ).bind(weekStart, CHAT_OPENER_AUTHOR, slotStart).first();

  return {
    id: Number(row?.id || 0),
    name: row?.name || CHAT_OPENER_AUTHOR,
    body: row?.body || body,
    createdAt: Number(row?.createdAt || slotStart)
  };
}

async function insertChatMessage(db, weekStart, name, body, createdAt = Date.now()) {
  const result = await db.prepare(
    `INSERT INTO chat_messages (week_start, name, body, created_at)
     VALUES (?, ?, ?, ?)`
  ).bind(weekStart, name, body, createdAt).run();
  return {
    id: Number(result.meta?.last_row_id || 0),
    name,
    body,
    createdAt
  };
}

async function updatePresence(db, weekStart, name) {
  await db.prepare(
    `INSERT INTO online_presence (week_start, name, last_seen)
     VALUES (?, ?, ?)
     ON CONFLICT(week_start, name) DO UPDATE SET last_seen = excluded.last_seen`
  ).bind(weekStart, name, Date.now()).run();
}

async function getOnlinePlayers(db, weekStart) {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  const rows = await db.prepare(
    `SELECT name, last_seen AS lastSeen
     FROM online_presence
     WHERE week_start = ? AND last_seen >= ?
     ORDER BY last_seen DESC
     LIMIT 30`
  ).bind(weekStart, cutoff).all();
  return (rows.results || []).map(row => ({
    name: row.name,
    lastSeen: Number(row.lastSeen || 0)
  }));
}

async function getPlayer(db, weekStart, name) {
  const row = await db.prepare(
    `SELECT week_start AS week, name, credits, best_coins AS bestCoins,
            best_single_win AS bestSingleWin, updated_at AS updatedAt
     FROM players
     WHERE week_start = ? AND name = ?
     LIMIT 1`
  ).bind(weekStart, name).first();
  if (!row) return null;
  return {
    week: row.week,
    name: row.name,
    credits: Number(row.credits || 0),
    bestCoins: Number(row.bestCoins || 0),
    bestSingleWin: Number(row.bestSingleWin || 0),
    updatedAt: Number(row.updatedAt || 0)
  };
}

async function getChampion(db, weekStart) {
  const row = await db.prepare(
    `SELECT week_start AS weekStart, week_label AS weekLabel,
            winner_name AS winnerName, winner_score AS winnerScore,
            biggest_win_name AS biggestWinName, biggest_win_score AS biggestWinScore
     FROM weekly_champions
     WHERE week_start = ?
     LIMIT 1`
  ).bind(weekStart).first();
  if (!row) return null;
  return {
    weekStart: row.weekStart,
    weekLabel: row.weekLabel,
    winner: row.winnerName ? { name: row.winnerName, score: Number(row.winnerScore || 0) } : null,
    biggestWin: row.biggestWinName ? { name: row.biggestWinName, score: Number(row.biggestWinScore || 0) } : null
  };
}

async function getMeta(db, key) {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  return row?.value || '';
}

async function setMeta(db, key, value) {
  await db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 80);
}

function cleanChatBody(body) {
  return String(body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX_LENGTH);
}

function toInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}

function berlinParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function keyFromUtcMs(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function utcMsFromKey(key) {
  const [year, month, day] = String(key || '').split('-').map(Number);
  return Date.UTC(year || 1970, (month || 1) - 1, day || 1);
}

function getWeekStart(date = new Date()) {
  const p = berlinParts(date);
  const currentDayMs = Date.UTC(p.year, p.month - 1, p.day);
  const day = new Date(currentDayMs).getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return keyFromUtcMs(currentDayMs + diff * 86400000);
}

function previousWeekStartFromKey(weekStart) {
  return keyFromUtcMs(utcMsFromKey(weekStart) - 7 * 86400000);
}

function weekLabel(weekStart) {
  const start = new Date(utcMsFromKey(weekStart));
  const end = new Date(utcMsFromKey(weekStart) + 6 * 86400000);
  const fmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}
