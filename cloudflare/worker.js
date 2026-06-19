const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Reset-Secret,X-Import-Secret'
};

const CHAT_LIMIT = 80;
const CHAT_MAX_LENGTH = 260;
const ONLINE_WINDOW_MS = 90000;
const CHAT_OPENER_AUTHOR = 'Käsino-Croupier';
const CHAT_OPENER_INTERVAL_MS = 12 * 60 * 60 * 1000;
const PRESTIGE_BOX_COST = 100000;
const PRESTIGE_UPGRADE_COSTS = [10, 20, 30];
const SEAL_DEFS = [
  { id: 'oligarchengedeck', rarity: 'common' },
  { id: 'senf-depot', rarity: 'common' },
  { id: 'fuego-lizenz', rarity: 'common' },
  { id: 'babybel-bankett', rarity: 'common' },
  { id: 'zweitbarbour', rarity: 'rare' },
  { id: 'schwarzes-durag', rarity: 'rare' },
  { id: 'sechseck-orden', rarity: 'rare' },
  { id: 'fondue-fonds', rarity: 'rare' },
  { id: 'oligarchenporsche', rarity: 'epic' },
  { id: 'roquefort-patina', rarity: 'epic' },
  { id: 'parmigiano-aktie', rarity: 'epic' },
  { id: 'weisses-durag', rarity: 'legendary' }
];
const RARITY_WEIGHTS = [
  { rarity: 'common', weight: 50 },
  { rarity: 'rare', weight: 30 },
  { rarity: 'epic', weight: 15 },
  { rarity: 'legendary', weight: 5 }
];
const SHARDS_BY_RARITY = { common: 1, rare: 2, epic: 5, legendary: 12 };
const DUPLICATE_DROP_CHANCE = 0.35;
const SEAL_IDS = new Set(SEAL_DEFS.map(seal => seal.id));
const ACTIVE_GAMEPLAY_SEALS = new Set(['oligarchengedeck', 'senf-depot', 'fuego-lizenz', 'babybel-bankett', 'weisses-durag', 'roquefort-patina']);
const TRANSIENT_ABILITY_KEYS = [
  'menuReady', 'menuCooldownUntil', 'menuSpinCounter', 'favoriteHits', 'favoriteWildSpins',
  'scharferSpinReady', 'senfDividendReady', 'senfTakeoverSpins',
  'fuegoDrySpins', 'fuegoRauschSpins', 'fuegoCooldownUntil',
  'buffetSpins', 'darkChamberCooldownUntil', 'duragSpinCounter',
  'hexJudgementSpins', 'hexSpinCounter', 'hexCooldownUntil',
  'premiumBoxReady', 'liquidityCooldownUntil', 'fondueBoxes',
  'porscheAutoSpins', 'porscheDrySpins',
  'grandeCaveReady', 'roqSpinCounter',
  'parmiPoints', 'walhallaBlessingReady', 'walhallaSegenSpins', 'walhallaEventSpins', 'walhallaCooldownUntil',
  'barbourReceipts', 'inheritanceCooldownUntil'
];
const CHAT_OPENERS = [
  'Was ist euer Lieblingskäse?',
  'Wie mögt ihr euren Obatzda am liebsten?',
  'Wer ist euer Zweitlieblingsoligarch?',
  'Welcher Käse ist massiv unterschätzt?',
  'Was ist der perfekte Snack zum Käsino?',
  'Welche Oligarchenstrategie fährt ihr heute?'
];
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 12;

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
    ON online_presence (week_start, last_seen DESC)`,
  `CREATE TABLE IF NOT EXISTS player_profiles (
    name TEXT PRIMARY KEY,
    seals_json TEXT NOT NULL DEFAULT '[]',
    active_seal TEXT,
    seal_shards INTEGER NOT NULL DEFAULT 0,
    seal_glow_json TEXT NOT NULL DEFAULT '{}',
    ability_state_json TEXT NOT NULL DEFAULT '{}',
    opened_boxes INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    name TEXT PRIMARY KEY,
    pin_salt TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS account_sessions (
    token_hash TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_account_sessions_name_expires
    ON account_sessions (name, expires_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_account_sessions_expires
    ON account_sessions (expires_at)`,
  `ALTER TABLE player_profiles ADD COLUMN ability_state_json TEXT NOT NULL DEFAULT '{}'`
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

  if (request.method === 'GET' && url.pathname === '/api/account/status') {
    const name = cleanName(url.searchParams.get('name') || '');
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    return json({ ok: true, name, exists: await accountExists(env.DB, name) });
  }

  if (request.method === 'POST' && url.pathname === '/api/account/register') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    const pin = cleanPin(payload.pin);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    if (!pin) return json({ ok: false, error: `PIN braucht ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} Zahlen.` }, 400);
    const result = await registerAccount(env.DB, name, pin);
    if (!result.ok) return json(result, result.status || 400);
    return json({ ...result, state: await buildState(env.DB, name, name) });
  }

  if (request.method === 'POST' && url.pathname === '/api/account/login') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    const pin = cleanPin(payload.pin);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    if (!pin) return json({ ok: false, error: `PIN braucht ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} Zahlen.` }, 400);
    const result = await loginAccount(env.DB, name, pin);
    if (!result.ok) return json(result, result.status || 401);
    return json({ ...result, state: await buildState(env.DB, name, name) });
  }

  if (request.method === 'GET' && url.pathname === '/api/account/session') {
    const name = cleanName(url.searchParams.get('name') || '');
    const authName = await getSessionName(env.DB, request);
    if (!authName || (name && authName !== name)) return json({ ok: false, error: 'Session abgelaufen.' }, 401);
    return json({ ok: true, name: authName, state: await buildState(env.DB, authName, authName) });
  }

  if (request.method === 'GET' && url.pathname === '/api/state') {
    const name = cleanName(url.searchParams.get('name') || '');
    const authName = await getSessionName(env.DB, request);
    return json(await buildState(env.DB, name, authName === name ? authName : ''));
  }

  if (request.method === 'PUT' && url.pathname === '/api/player') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    const authError = await requireAuthName(env.DB, request, name);
    if (authError) return authError;
    await upsertPlayer(env.DB, {
      name,
      credits: toInt(payload.credits, 100),
      bestCoins: toInt(payload.credits, 100),
      bestSingleWin: 0,
      updatedAt: toInt(payload.updatedAt, Date.now())
    });
    return json(await buildState(env.DB, name, name));
  }

  if (request.method === 'POST' && url.pathname === '/api/leaderboard') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    const authError = await requireAuthName(env.DB, request, name);
    if (authError) return authError;
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
    return json(await buildState(env.DB, name, name));
  }

  if (request.method === 'POST' && url.pathname === '/api/profile/open-box') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    const authError = await requireAuthName(env.DB, request, name);
    if (authError) return authError;
    await upsertPlayer(env.DB, {
      name,
      credits: toInt(payload.credits, 100),
      bestCoins: toInt(payload.bestCoins ?? payload.credits, 100),
      bestSingleWin: toInt(payload.bestSingleWin, 0),
      updatedAt: toInt(payload.updatedAt, Date.now())
    });
    const result = await openPrestigeBox(env.DB, name, payload.premium === true);
    return json(result, result.status || 200);
  }

  if (request.method === 'POST' && url.pathname === '/api/profile/active-seal') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    const sealId = cleanSealId(payload.sealId);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    if (!sealId) return json({ ok: false, error: 'Siegel fehlt.' }, 400);
    const authError = await requireAuthName(env.DB, request, name);
    if (authError) return authError;
    const profile = await setActiveSeal(env.DB, name, sealId);
    return json({
      ok: true,
      profile,
      profileStats: await getPublicProfileStats(env.DB, await ensureCurrentWeek(env.DB), name, profile),
      profiles: { [name]: profile }
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/profile/upgrade-seal') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    const sealId = cleanSealId(payload.sealId);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    if (!sealId) return json({ ok: false, error: 'Siegel fehlt.' }, 400);
    const authError = await requireAuthName(env.DB, request, name);
    if (authError) return authError;
    const profile = await upgradeSeal(env.DB, name, sealId);
    return json({
      ok: true,
      profile,
      profileStats: await getPublicProfileStats(env.DB, await ensureCurrentWeek(env.DB), name, profile),
      profiles: { [name]: profile }
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/profile/ability') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    const authError = await requireAuthName(env.DB, request, name);
    if (authError) return authError;
    const profile = await updateAbilityState(env.DB, name, payload.abilityState);
    return json({
      ok: true,
      profile,
      profileStats: await getPublicProfileStats(env.DB, await ensureCurrentWeek(env.DB), name, profile),
      profiles: { [name]: profile }
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/chat') {
    const weekStart = await ensureCurrentWeek(env.DB);
    const after = Math.max(0, toInt(url.searchParams.get('after'), 0));
    const opener = await ensureChatOpener(env.DB, weekStart);
    const messages = await getChatMessages(env.DB, weekStart, after);
    const online = await getOnlinePlayers(env.DB, weekStart);
    const names = uniqueNames([
      ...messages.map(message => message.name),
      ...online.map(player => player.name)
    ]);
    return json({
      ok: true,
      weekStart,
      currentOpener: opener.body,
      messages,
      online,
      profiles: await getProfilesMap(env.DB, names)
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/chat') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    const body = cleanChatBody(payload.body);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    if (name === CHAT_OPENER_AUTHOR) return json({ ok: false, error: 'Dieser Chatname ist reserviert.' }, 400);
    if (!body) return json({ ok: false, error: 'Nachricht fehlt.' }, 400);
    const authError = await requireAuthName(env.DB, request, name);
    if (authError) return authError;
    const weekStart = await ensureCurrentWeek(env.DB);
    const opener = await ensureChatOpener(env.DB, weekStart);
    await updatePresence(env.DB, weekStart, name);
    const message = await insertChatMessage(env.DB, weekStart, name, body);
    const online = await getOnlinePlayers(env.DB, weekStart);
    const names = uniqueNames([name, ...online.map(player => player.name)]);
    return json({
      ok: true,
      weekStart,
      currentOpener: opener.body,
      message,
      messages: [message],
      online,
      profiles: await getProfilesMap(env.DB, names)
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/presence') {
    const payload = await request.json();
    const name = cleanName(payload.name);
    if (!name) return json({ ok: false, error: 'Name fehlt.' }, 400);
    const authError = await requireAuthName(env.DB, request, name);
    if (authError) return authError;
    const weekStart = await ensureCurrentWeek(env.DB);
    await updatePresence(env.DB, weekStart, name);
    const online = await getOnlinePlayers(env.DB, weekStart);
    return json({
      ok: true,
      weekStart,
      online,
      profiles: await getProfilesMap(env.DB, uniqueNames([name, ...online.map(player => player.name)]))
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
  for (const sql of SCHEMA) {
    try {
      await db.prepare(sql).run();
    } catch (error) {
      if (!/duplicate column/i.test(error?.message || String(error))) throw error;
    }
  }
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

async function accountExists(db, name) {
  const row = await db.prepare('SELECT name FROM accounts WHERE name = ? LIMIT 1').bind(name).first();
  return !!row;
}

async function registerAccount(db, name, pin) {
  if (await accountExists(db, name)) {
    return { ok: false, error: 'Dieser Name ist schon reserviert. Bitte einloggen.', status: 409 };
  }
  const now = Date.now();
  const salt = randomHex(16);
  const pinHash = await hashPin(pin, salt);
  await db.prepare(
    `INSERT INTO accounts (name, pin_salt, pin_hash, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(name, salt, pinHash, now, now, now).run();
  const session = await createSession(db, name);
  return { ok: true, name, ...session, created: true };
}

async function loginAccount(db, name, pin) {
  const row = await db.prepare(
    `SELECT name, pin_salt AS pinSalt, pin_hash AS pinHash
     FROM accounts
     WHERE name = ?
     LIMIT 1`
  ).bind(name).first();
  if (!row) return { ok: false, error: 'Diesen Namen gibt es noch nicht. PIN festlegen und los.', status: 404 };
  const expected = String(row.pinHash || '');
  const actual = await hashPin(pin, String(row.pinSalt || ''));
  if (actual !== expected) return { ok: false, error: 'PIN falsch. Der Käsekeller bleibt zu.', status: 401 };
  const now = Date.now();
  await db.prepare(
    `UPDATE accounts
     SET last_login_at = ?, updated_at = ?
     WHERE name = ?`
  ).bind(now, now, name).run();
  const session = await createSession(db, name);
  return { ok: true, name, ...session, created: false };
}

async function createSession(db, name) {
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  await db.batch([
    db.prepare('DELETE FROM account_sessions WHERE expires_at < ?').bind(now),
    db.prepare(
      `INSERT INTO account_sessions (token_hash, name, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(tokenHash, name, now, expiresAt, now)
  ]);
  return { token, expiresAt };
}

async function getSessionName(db, request) {
  const token = getBearerToken(request);
  if (!token) return '';
  const now = Date.now();
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(
    `SELECT name, expires_at AS expiresAt
     FROM account_sessions
     WHERE token_hash = ?
     LIMIT 1`
  ).bind(tokenHash).first();
  if (!row || Number(row.expiresAt || 0) <= now) return '';
  await db.prepare(
    `UPDATE account_sessions
     SET last_seen_at = ?
     WHERE token_hash = ?`
  ).bind(now, tokenHash).run();
  return cleanName(row.name);
}

async function requireAuthName(db, request, name) {
  const authName = await getSessionName(db, request);
  if (!authName) return json({ ok: false, error: 'Bitte mit Name und PIN einloggen.' }, 401);
  if (authName !== name) return json({ ok: false, error: 'Diese Session gehört zu einem anderen Namen.' }, 403);
  return null;
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

async function buildState(db, name = '', authName = '') {
  const currentWeek = await ensureCurrentWeek(db);
  const leaderboard = await buildLeaderboard(db, currentWeek, name);
  const names = uniqueNames([
    name,
    ...((leaderboard.coins || []).map(row => row.name)),
    ...((leaderboard.wins || []).map(row => row.name)),
    leaderboard.lastWeek?.winner?.name,
    leaderboard.lastWeek?.biggestWin?.name
  ]);
  const profiles = await getProfilesMap(db, names);
  return {
    ok: true,
    leaderboard: { ...leaderboard, profiles },
    player: name && authName === name ? await getPlayer(db, currentWeek, name) : null,
    profileStats: name ? await getPublicProfileStats(db, currentWeek, name, profiles[name]) : null,
    profile: name ? (profiles[name] || defaultProfile(name)) : null,
    profiles
  };
}

async function buildLeaderboard(db, weekStart, focusName = '') {
  const resetEpoch = await getMeta(db, 'reset_epoch') || '';
  const coins = await db.prepare(
    `SELECT name, best_coins AS score, credits AS current
     FROM players
     WHERE week_start = ?
     ORDER BY best_coins DESC, updated_at ASC, name ASC
     LIMIT 10`
  ).bind(weekStart).all();

  const wins = await db.prepare(
    `SELECT name, best_single_win AS score
     FROM players
     WHERE week_start = ? AND best_single_win > 0
     ORDER BY best_single_win DESC, updated_at ASC, name ASC
     LIMIT 10`
  ).bind(weekStart).all();

  return {
    weekStart,
    resetEpoch,
    coins: (coins.results || []).map(row => ({
      name: row.name,
      score: Number(row.score || 0),
      current: Number(row.current || 0)
    })),
    wins: (wins.results || []).map(row => ({ name: row.name, score: Number(row.score || 0) })),
    personalRank: focusName ? await getPersonalRank(db, weekStart, focusName) : null,
    lastWeek: await getChampion(db, previousWeekStartFromKey(weekStart))
  };
}

async function getPersonalRank(db, weekStart, name) {
  const clean = cleanName(name);
  if (!clean) return null;
  const row = await db.prepare(
    `SELECT name, best_coins AS score, credits AS current, updated_at AS updatedAt
     FROM players
     WHERE week_start = ? AND name = ?
     LIMIT 1`
  ).bind(weekStart, clean).first();
  if (!row) return null;
  const score = Number(row.score || 0);
  const updatedAt = Number(row.updatedAt || 0);
  const higher = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM players
     WHERE week_start = ?
       AND (
         best_coins > ?
         OR (
           best_coins = ?
           AND (
             updated_at < ?
             OR (updated_at = ? AND name < ?)
           )
         )
       )`
  ).bind(weekStart, score, score, updatedAt, updatedAt, clean).first();
  const rank = Number(higher?.count || 0) + 1;
  return {
    name: row.name,
    rank,
    score,
    current: Number(row.current || 0),
    inTop10: rank <= 10
  };
}

async function getPublicProfileStats(db, weekStart, name, profile = null) {
  const clean = cleanName(name);
  if (!clean) return null;
  const [player, rank] = await Promise.all([
    getPlayer(db, weekStart, clean),
    getPersonalRank(db, weekStart, clean)
  ]);
  const publicProfile = profile || await getProfile(db, clean);
  return {
    name: clean,
    rank: rank?.rank || null,
    bestCoins: rank?.score ?? player?.bestCoins ?? 0,
    current: player?.credits ?? rank?.current ?? null,
    bestSingleWin: player?.bestSingleWin ?? 0,
    openedBoxes: Math.max(0, toInt(publicProfile?.openedBoxes, 0)),
    sealShards: Math.max(0, toInt(publicProfile?.sealShards, 0)),
    sealCount: Array.isArray(publicProfile?.seals) ? publicProfile.seals.length : 0,
    activeSeal: publicProfile?.activeSeal || ''
  };
}

function defaultProfile(name) {
  return {
    name,
    seals: [],
    activeSeal: '',
    sealShards: 0,
    sealGlow: {},
    abilityState: {},
    openedBoxes: 0,
    updatedAt: 0
  };
}

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function normalizeProfile(row, name = '') {
  if (!row) return defaultProfile(name);
  const seals = Array.isArray(safeJson(row.seals_json, []))
    ? safeJson(row.seals_json, []).filter(id => SEAL_IDS.has(id))
    : [];
  const sealGlow = safeJson(row.seal_glow_json, {});
  const abilityState = safeJson(row.ability_state_json, {});
  const cleanGlow = {};
  for (const [id, value] of Object.entries(sealGlow)) {
    if (SEAL_IDS.has(id)) cleanGlow[id] = Math.max(0, Math.min(3, toInt(value, 0)));
  }
  const activeSeal = SEAL_IDS.has(row.active_seal) && seals.includes(row.active_seal)
    ? row.active_seal
    : (seals[seals.length - 1] || '');
  return {
    name: row.name || name,
    seals,
    activeSeal,
    sealShards: Math.max(0, toInt(row.seal_shards, 0)),
    sealGlow: cleanGlow,
    abilityState: abilityState && typeof abilityState === 'object' ? abilityState : {},
    openedBoxes: Math.max(0, toInt(row.opened_boxes, 0)),
    updatedAt: Math.max(0, toInt(row.updated_at, 0))
  };
}

function cleanAbilityState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(raw)) {
    const safeKey = String(key || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    if (!safeKey) continue;
    if (typeof value === 'number') clean[safeKey] = Number.isFinite(value) ? Math.floor(value) : 0;
    else if (typeof value === 'boolean') clean[safeKey] = value;
    else if (typeof value === 'string') clean[safeKey] = value.slice(0, 80);
    else if (value && typeof value === 'object' && !Array.isArray(value)) clean[safeKey] = cleanAbilityState(value);
  }
  return clean;
}

function cleanupTransientAbilityState(raw) {
  const clean = cleanAbilityState(raw || {});
  for (const key of TRANSIENT_ABILITY_KEYS) delete clean[key];
  return clean;
}

function gameplaySealActive(sealId) {
  return ACTIVE_GAMEPLAY_SEALS.has(sealId);
}

function sealUpgradeCost(currentGlow) {
  const glow = Math.max(0, toInt(currentGlow, 0));
  return glow >= 3 ? Infinity : (PRESTIGE_UPGRADE_COSTS[glow] || 10);
}

function prestigeBoxCost(profile, premium = false) {
  if (premium && profile?.activeSeal === 'fondue-fonds' && gameplaySealActive('fondue-fonds') && Math.max(0, toInt(profile?.sealGlow?.['fondue-fonds'], 0)) >= 3) {
    return 150000;
  }
  const glow = Math.max(0, toInt(profile?.sealGlow?.['fondue-fonds'], 0));
  if (profile?.activeSeal === 'fondue-fonds' && gameplaySealActive('fondue-fonds')) {
    if (glow >= 2) return 75000;
    if (glow >= 1) return 85000;
  }
  return PRESTIGE_BOX_COST;
}

async function getProfile(db, name) {
  const clean = cleanName(name);
  if (!clean) return defaultProfile('');
  const row = await db.prepare(
    `SELECT name, seals_json, active_seal, seal_shards, seal_glow_json, ability_state_json, opened_boxes, updated_at
     FROM player_profiles
     WHERE name = ?
     LIMIT 1`
  ).bind(clean).first();
  return normalizeProfile(row, clean);
}

async function updateAbilityState(db, name, abilityState) {
  const profile = await getProfile(db, name);
  profile.abilityState = cleanAbilityState(abilityState || {});
  return saveProfile(db, profile);
}

async function saveProfile(db, profile) {
  const now = Date.now();
  const activeSeal = profile.activeSeal && profile.seals.includes(profile.activeSeal)
    ? profile.activeSeal
    : (profile.seals[profile.seals.length - 1] || null);
  await db.prepare(
    `INSERT INTO player_profiles
      (name, seals_json, active_seal, seal_shards, seal_glow_json, ability_state_json, opened_boxes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       seals_json = excluded.seals_json,
       active_seal = excluded.active_seal,
       seal_shards = excluded.seal_shards,
       seal_glow_json = excluded.seal_glow_json,
       ability_state_json = excluded.ability_state_json,
       opened_boxes = excluded.opened_boxes,
       updated_at = excluded.updated_at`
  ).bind(
    profile.name,
    JSON.stringify(profile.seals),
    activeSeal,
    Math.max(0, toInt(profile.sealShards, 0)),
    JSON.stringify(profile.sealGlow || {}),
    JSON.stringify(cleanAbilityState(profile.abilityState || {})),
    Math.max(0, toInt(profile.openedBoxes, 0)),
    now
  ).run();
  return { ...profile, activeSeal: activeSeal || '', abilityState: cleanAbilityState(profile.abilityState || {}), updatedAt: now };
}

async function getProfilesMap(db, names) {
  const cleanNames = uniqueNames(names).filter(name => name && name !== CHAT_OPENER_AUTHOR);
  const map = {};
  if (!cleanNames.length) return map;
  const placeholders = cleanNames.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT name, seals_json, active_seal, seal_shards, seal_glow_json, ability_state_json, opened_boxes, updated_at
     FROM player_profiles
     WHERE name IN (${placeholders})`
  ).bind(...cleanNames).all();
  for (const row of rows.results || []) {
    map[row.name] = normalizeProfile(row, row.name);
  }
  for (const name of cleanNames) {
    if (!map[name]) map[name] = defaultProfile(name);
  }
  return map;
}

function uniqueNames(names) {
  return Array.from(new Set((names || []).map(cleanName).filter(Boolean)));
}

function pickRarity() {
  const total = RARITY_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of RARITY_WEIGHTS) {
    roll -= entry.weight;
    if (roll < 0) return entry.rarity;
  }
  return 'common';
}

function pickSealForRarity(rarity, owned) {
  const pool = SEAL_DEFS.filter(seal => seal.rarity === rarity);
  const fresh = pool.filter(seal => !owned.has(seal.id));
  const duplicates = pool.filter(seal => owned.has(seal.id));
  const shouldDuplicate = duplicates.length && Math.random() < DUPLICATE_DROP_CHANCE;
  const choices = shouldDuplicate ? duplicates : (fresh.length ? fresh : pool);
  return choices[Math.floor(Math.random() * choices.length)];
}

async function openPrestigeBox(db, name, premium = false) {
  const weekStart = await ensureCurrentWeek(db);
  const player = await getPlayer(db, weekStart, name);
  const profile = await getProfile(db, name);
  const boxCost = prestigeBoxCost(profile, premium);
  if (!player || player.credits < boxCost) {
    return jsonLikeError('Nicht genug Coins für die Couture-Kiste.', 400);
  }
  const rarity = pickRarity();
  let seal = pickSealForRarity(rarity, new Set(profile.seals));
  if (premium && profile.activeSeal === 'fondue-fonds' && gameplaySealActive('fondue-fonds')) {
    const fresh = SEAL_DEFS.filter(entry => !profile.seals.includes(entry.id));
    if (fresh.length && Math.random() < 0.65) seal = fresh[Math.floor(Math.random() * fresh.length)];
  }
  const duplicate = profile.seals.includes(seal.id);
  const fondueGlow = profile.activeSeal === 'fondue-fonds' && gameplaySealActive('fondue-fonds') ? Math.max(0, toInt(profile.sealGlow?.['fondue-fonds'], 0)) : 0;
  const shardBonus = fondueGlow >= 2 ? 2 : 0;
  const shardMultiplier = premium && fondueGlow >= 3 ? 3 : 1;
  const shards = duplicate ? ((SHARDS_BY_RARITY[seal.rarity || rarity] || 1) + shardBonus) * shardMultiplier : 0;

  if (duplicate) {
    profile.sealShards += shards;
  } else {
    profile.seals.push(seal.id);
    profile.activeSeal = seal.id;
    profile.abilityState = cleanupTransientAbilityState(profile.abilityState);
  }
  profile.openedBoxes += 1;
  const savedProfile = await saveProfile(db, profile);
  const updatedAt = Date.now();
  const nextCredits = player.credits - boxCost;
  await db.prepare(
    `UPDATE players
     SET credits = ?, best_coins = max(best_coins, ?), updated_at = ?
     WHERE week_start = ? AND name = ?`
  ).bind(nextCredits, player.bestCoins, updatedAt, weekStart, name).run();

  const leaderboard = await buildLeaderboard(db, weekStart, name);
  const profiles = await getProfilesMap(db, uniqueNames([
    name,
    ...(leaderboard.coins || []).map(row => row.name),
    ...(leaderboard.wins || []).map(row => row.name)
  ]));
  profiles[name] = savedProfile;
  return {
    ok: true,
    result: { sealId: seal.id, rarity: seal.rarity || rarity, duplicate, shards, premium },
    player: { ...player, credits: nextCredits, updatedAt },
    profile: savedProfile,
    profileStats: await getPublicProfileStats(db, weekStart, name, savedProfile),
    profiles,
    leaderboard: { ...leaderboard, profiles }
  };
}

function jsonLikeError(error, status) {
  return { ok: false, error, status };
}

async function setActiveSeal(db, name, sealId) {
  const profile = await getProfile(db, name);
  if (!profile.seals.includes(sealId)) throw new Error('Siegel nicht freigeschaltet.');
  profile.activeSeal = sealId;
  profile.abilityState = cleanupTransientAbilityState(profile.abilityState);
  return saveProfile(db, profile);
}

async function upgradeSeal(db, name, sealId) {
  const profile = await getProfile(db, name);
  if (!profile.seals.includes(sealId)) throw new Error('Siegel nicht freigeschaltet.');
  const current = Math.max(0, toInt(profile.sealGlow[sealId], 0));
  if (current >= 3) throw new Error('Dieses Siegel ist schon Walhalla.');
  const upgradeCost = sealUpgradeCost(current);
  if (profile.sealShards < upgradeCost) throw new Error(`Nicht genug Couture-Splitter. Diese Veredelung kostet ${upgradeCost}.`);
  profile.sealShards -= upgradeCost;
  profile.sealGlow[sealId] = current + 1;
  profile.activeSeal = sealId;
  profile.abilityState = cleanupTransientAbilityState(profile.abilityState);
  return saveProfile(db, profile);
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

function cleanPin(pin) {
  const clean = String(pin || '').trim();
  if (!new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(clean)) return '';
  return clean;
}

function getBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function randomHex(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function hashPin(pin, salt) {
  return sha256Hex(`${salt}:${pin}`);
}

function cleanSealId(sealId) {
  const clean = String(sealId || '').trim().slice(0, 80);
  return SEAL_IDS.has(clean) ? clean : '';
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
