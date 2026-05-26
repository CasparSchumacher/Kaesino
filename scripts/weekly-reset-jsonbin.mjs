import fs from 'node:fs';

const INDEX_HTML = fs.readFileSync('index.html', 'utf8');
const JSONBIN_ID = process.env.JSONBIN_ID || readConst('JSONBIN_ID');
const JSONBIN_KEY = process.env.JSONBIN_KEY || readConst('JSONBIN_KEY');
const API_BASE = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;

function readConst(name) {
  const match = INDEX_HTML.match(new RegExp(`const\\s+${name}\\s*=\\s*'([^']+)'`));
  return match ? match[1] : '';
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
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function getWeekStart(date = new Date()) {
  const p = berlinParts(date);
  const currentDayMs = Date.UTC(p.year, p.month - 1, p.day);
  const day = new Date(currentDayMs).getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  let mondayMs = currentDayMs + diff * 86400000;
  if (day === 1 && (p.hour === 0 && p.minute < 1)) mondayMs -= 7 * 86400000;
  return keyFromUtcMs(mondayMs);
}

function getPreviousWeekStart(date = new Date()) {
  return keyFromUtcMs(utcMsFromKey(getWeekStart(date)) - 7 * 86400000);
}

function weekLabel(weekStart) {
  const start = new Date(utcMsFromKey(weekStart));
  const end = new Date(utcMsFromKey(weekStart) + 6 * 86400000);
  const fmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

function archiveWeek(stored, previousWeekStart) {
  const winner = stored.coins && stored.coins.length > 0 ? stored.coins[0] : null;
  const biggestWin = stored.wins && stored.wins.length > 0 ? stored.wins[0] : null;
  if (!winner && !biggestWin) return stored.lastWeek || null;
  if (stored.weekStart !== previousWeekStart) return stored.lastWeek || null;
  return {
    weekStart: previousWeekStart,
    weekLabel: weekLabel(previousWeekStart),
    winner,
    biggestWin
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': JSONBIN_KEY,
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return response.json();
}

async function main() {
  if (!JSONBIN_ID || !JSONBIN_KEY) throw new Error('JSONBIN_ID/JSONBIN_KEY fehlen.');

  const now = new Date();
  const currentWeek = getWeekStart(now);
  const previousWeek = getPreviousWeekStart(now);
  const latest = await requestJson(`${API_BASE}/latest`);
  const stored = latest.record || {};

  if (stored.weekStart === currentWeek) {
    console.log(`Schon aktuelle Woche ${currentWeek}; kein Reset noetig.`);
    return;
  }

  const nextRecord = {
    weekStart: currentWeek,
    resetEpoch: `${currentWeek}-${Date.now()}`,
    coins: [],
    wins: [],
    lastWeek: archiveWeek(stored, previousWeek)
  };

  await requestJson(API_BASE, {
    method: 'PUT',
    body: JSON.stringify(nextRecord)
  });
  console.log(`Reset auf Woche ${currentWeek}; archiviert: ${nextRecord.lastWeek ? nextRecord.lastWeek.weekLabel : 'keine Vorwoche'}.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
