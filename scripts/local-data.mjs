import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const database = new URL('../data/marketmind.sqlite', import.meta.url);
const expiry = 7 * 86_400_000;
const scrypt = promisify(derive);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const json = (value, status = 200, headers = {}) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const tables = {
  accounts: ['id', 'username', 'email', 'password_status', 'role', 'created_at'],
  headlines: ['published_at', 'publisher', 'title', 'sentiment', 'confidence', 'url'],
  quotes: ['recorded_at', 'pair', 'price_usd'],
  candles: ['closed_at', 'pair', 'open_usd', 'high_usd', 'low_usd', 'close_usd'],
  analyses: ['created_at', 'username', 'headline', 'sentiment', 'confidence'],
};
const order = { accounts: 'id', headlines: 'published_at', quotes: 'recorded_at', candles: 'closed_at', analyses: 'id' };
const accountColumns = "id, username, email, 'Set' AS password_status, role, created_at";
const publicAccount = ({ username, email, role }) => ({ username, email, role });

function normalizeEmail(input) {
  const email = typeof input === 'string' ? input.trim().toLowerCase() : '';
  return email.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email) ? email : null;
}

export function openLocalData(origin, location = database) {
  mkdirSync(new URL('./', location), { recursive: true });
  const db = new DatabaseSync(fileURLToPath(location));
  function transaction(write) {
    db.exec('BEGIN IMMEDIATE');
    try { write(); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL,
      password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')),
      created_at INTEGER NOT NULL, email TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_admin ON accounts(role) WHERE role = 'admin';
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL, PRIMARY KEY(account_id, symbol)
    );
    CREATE TABLE IF NOT EXISTS headlines (
      url TEXT PRIMARY KEY, published_at INTEGER NOT NULL, publisher TEXT NOT NULL,
      title TEXT NOT NULL, sentiment TEXT NOT NULL, confidence REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      pair TEXT NOT NULL, recorded_at INTEGER NOT NULL, price_usd REAL NOT NULL,
      PRIMARY KEY(pair, recorded_at)
    );
    CREATE TABLE IF NOT EXISTS candles (
      pair TEXT NOT NULL, closed_at INTEGER NOT NULL, open_usd REAL NOT NULL, high_usd REAL NOT NULL,
      low_usd REAL NOT NULL, close_usd REAL NOT NULL, PRIMARY KEY(pair, closed_at)
    );
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
      created_at INTEGER NOT NULL, headline TEXT NOT NULL, sentiment TEXT NOT NULL, confidence REAL NOT NULL
    );
  `);
  transaction(() => {
    if (!db.prepare('PRAGMA table_info(accounts)').all().some(({ name }) => name === 'email')) {
      db.exec('ALTER TABLE accounts ADD COLUMN email TEXT');
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON accounts(email COLLATE NOCASE)');
  });
  const hasAdmin = db.prepare("SELECT 1 FROM accounts WHERE role = 'admin'");
  let setupCode = hasAdmin.get() ? null : randomBytes(12).toString('hex');
  const dummySalt = randomBytes(16).toString('hex');
  const attempts = new Map();
  const selectSession = db.prepare(`
    SELECT accounts.id, username, email, role FROM sessions JOIN accounts ON accounts.id = sessions.account_id
    WHERE token_hash = ? AND expires_at > ?
  `);
  const addAccount = db.prepare('INSERT OR IGNORE INTO accounts(username, email, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const selectAccount = db.prepare('SELECT id, username, email, role, password_hash, salt FROM accounts WHERE username = ?');
  const setEmail = db.prepare('UPDATE OR IGNORE accounts SET email = ? WHERE id = ? AND email IS NULL');
  const addSession = db.prepare('INSERT INTO sessions VALUES (?, ?, ?)');
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const listFavorites = db.prepare('SELECT symbol FROM favorites WHERE account_id = ? ORDER BY symbol');
  const saveFavorite = db.prepare('INSERT OR IGNORE INTO favorites VALUES (?, ?)');
  const removeFavorite = db.prepare('DELETE FROM favorites WHERE account_id = ? AND symbol = ?');
  const addHeadline = db.prepare('INSERT OR IGNORE INTO headlines VALUES (?, ?, ?, ?, ?, ?)');
  const addQuote = db.prepare('INSERT OR IGNORE INTO quotes VALUES (?, ?, ?)');
  const addCandle = db.prepare('INSERT OR IGNORE INTO candles VALUES (?, ?, ?, ?, ?, ?)');
  const addAnalysis = db.prepare('INSERT INTO analyses(account_id, created_at, headline, sentiment, confidence) VALUES (?, ?, ?, ?, ?)');
  const reads = Object.fromEntries(Object.entries(tables).map(([table, fields]) => [
    table, {
      count: db.prepare(`SELECT COUNT(*) AS total FROM ${table}`),
      list: db.prepare(`SELECT ${table === 'accounts' ? accountColumns : table === 'analyses' ? fields.map((field) => field === 'username' ? 'accounts.username' : 'analyses.' + field).join(', ') : fields.join(', ')}
        FROM ${table === 'analyses' ? 'analyses JOIN accounts ON analyses.account_id = accounts.id' : table}
        ORDER BY ${table === 'analyses' ? 'analyses.' : ''}${order[table]} DESC LIMIT ? OFFSET ?`),
    },
  ]));
  const sessionCookie = (value, seconds) => ({
    'Set-Cookie': `mm_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}`,
  });
  const sessionKey = (request) => {
    const value = request.headers.get('cookie')?.match(/(?:^|;\s*)mm_session=([\w-]{43})(?:;|$)/)?.[1];
    return value ? hash(value) : '';
  };
  const userFor = (request) => selectSession.get(sessionKey(request), Date.now());

  async function favorites(request) {
    const user = userFor(request);
    if (!user) return json({ error: 'Sign in to use your account watchlist.' }, 401);
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== origin) return json({ error: 'Use the local site for this action.' }, 403);
      const input = await request.json().catch(() => null);
      if (!input || typeof input.symbol !== 'string' || !/^[A-Z0-9]{2,10}$/.test(input.symbol) || typeof input.saved !== 'boolean') {
        return json({ error: 'Invalid watchlist request.' }, 400);
      }
      if (input.saved && listFavorites.all(user.id).length >= 30) return json({ error: 'Watchlist is full.' }, 409);
      (input.saved ? saveFavorite : removeFavorite).run(user.id, input.symbol);
    } else if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
    return json({ symbols: listFavorites.all(user.id).map(({ symbol }) => symbol) });
  }

  function newSession(request, user) {
    const value = token();
    deleteSession.run(sessionKey(request));
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    addSession.run(hash(value), user.id, Date.now() + expiry);
    return json({ user: publicAccount(user) }, 200, sessionCookie(value, expiry / 1000));
  }

  async function accounts(request, path) {
    const user = userFor(request);
    if (request.method === 'GET' && path === 'session') {
      return json({ available: true, user: user ? publicAccount(user) : null, setupRequired: !hasAdmin.get() });
    }
    if (request.method !== 'POST' || request.headers.get('origin') !== origin) return json({ error: 'Use the local site for this action.' }, 403);
    if (path === 'logout') {
      deleteSession.run(sessionKey(request));
      return json({ user: null }, 200, sessionCookie('', 0));
    }
    if (path === 'email') {
      if (!user) return json({ error: 'Sign in to add your email.' }, 401);
      const data = await request.json().catch(() => null);
      const email = normalizeEmail(data?.email);
      if (!email) return json({ error: 'Enter a valid email address.' }, 400);
      if (!setEmail.run(email, user.id).changes) return json({ error: 'An email is already set or this email is in use.' }, 409);
      return json({ user: publicAccount({ ...user, email }) });
    }
    if (!['login', 'register', 'setup'].includes(path)) return json({ error: 'Unknown action.' }, 404);
    const data = await request.json().catch(() => null);
    if (!data || typeof data.username !== 'string' || typeof data.password !== 'string') return json({ error: 'Enter a username and password.' }, 400);
    const username = data.username.trim();
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username) || data.password.length < 10 || data.password.length > 128) {
      return json({ error: 'Use 3–32 letters, numbers, dots, dashes or underscores for the username and 10–128 characters for the password.' }, 400);
    }
    const email = normalizeEmail(data.email);
    if (path !== 'login' && !email) return json({ error: 'Enter a valid email address.' }, 400);
    if (path !== 'login' && data.confirmPassword !== data.password) return json({ error: 'Passwords do not match.' }, 400);
    const time = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= time) attempts.delete(key);
    const bucket = path === 'login' ? username.toLowerCase() : path === 'setup' ? ':setup' : ':register';
    const attempt = attempts.get(bucket) ?? { count: 0, until: time + 60_000 };
    if (attempt.count >= 8 || (attempts.size >= 2000 && !attempts.has(bucket))) return json({ error: 'Too many attempts. Try again in a minute.' }, 429);
    attempt.count++;
    attempts.set(bucket, attempt);
    if (path === 'login') {
      const account = selectAccount.get(username);
      const actual = await scrypt(data.password, account?.salt ?? dummySalt, 64);
      if (!account || !timingSafeEqual(actual, Buffer.from(account.password_hash, 'hex'))) return json({ error: 'Incorrect username or password.' }, 401);
      attempts.delete(bucket);
      return newSession(request, account);
    }
    if (path === 'setup' && (!setupCode || hasAdmin.get() || data.setupCode !== setupCode)) {
      return json({ error: 'Use the admin setup code printed in the server window.' }, 403);
    }
    const salt = randomBytes(16).toString('hex');
    const password = (await scrypt(data.password, salt, 64)).toString('hex');
    const role = path === 'setup' ? 'admin' : 'member';
    const created = addAccount.run(username, email, password, salt, role, time);
    if (!created.changes) return json({ error: 'That username, email address, or administrator slot is already taken.' }, 409);
    if (path === 'setup') setupCode = null;
    return newSession(request, { id: created.lastInsertRowid, username, email, role });
  }

  async function market(url) {
    const endpoint = url.searchParams.get('endpoint');
    const pair = url.searchParams.get('pair') ?? '';
    if (!['Ticker', 'OHLC'].includes(endpoint) || !/^[A-Z0-9]{2,12}(?:,[A-Z0-9]{2,12}){0,30}$/.test(pair) || (endpoint === 'OHLC' && pair.includes(','))) {
      return json({ error: ['Invalid market request'] }, 400);
    }
    let payload;
    try {
      const upstream = new URL('https://api.kraken.com/0/public/' + endpoint);
      upstream.searchParams.set('pair', pair);
      if (endpoint === 'OHLC') upstream.searchParams.set('interval', '60');
      const response = await fetch(upstream, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Kraken unavailable');
      payload = await response.json();
    } catch { return json({ error: ['Kraken is unavailable'] }, 502); }
    if (!payload.error?.length && payload.result) {
      transaction(() => {
        const minute = Math.floor(Date.now() / 60_000) * 60_000;
        for (const [symbol, series] of Object.entries(payload.result)) {
          if (endpoint === 'Ticker') {
            const price = Number(series.c?.[0]);
            if (Number.isFinite(price)) addQuote.run(symbol, minute, price);
          } else if (Array.isArray(series)) {
            for (const row of series.slice(-169, -1)) {
              const [time, open, high, low, close] = row.slice(0, 5).map(Number);
              if ([time, open, high, low, close].every(Number.isFinite)) addCandle.run(pair, (time + 3600) * 1000, open, high, low, close);
            }
          }
        }
      });
    }
    return json(payload);
  }

  return {
    setupCode,
    async route(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/local/account/')) return accounts(request, url.pathname.split('/').at(-1));
      if (url.pathname === '/api/local/favorites') return favorites(request);
      if (url.pathname === '/api/local/market' && request.method === 'GET') return market(url);
      if (url.pathname === '/api/local/database' && request.method === 'GET') {
        const user = userFor(request);
        if (user?.role !== 'admin') return json({ error: 'Administrator sign-in required.' }, user ? 403 : 401);
        const table = url.searchParams.get('table') ?? 'accounts';
        if (!Object.hasOwn(reads, table)) return json({ error: 'Unknown table' }, 404);
        const page = Math.max(1, Math.min(1_000_000, Number.parseInt(url.searchParams.get('page'), 10) || 1));
        const { count, list } = reads[table];
        return json({ columns: tables[table], rows: list.all(25, (page - 1) * 25), total: count.get().total, page, pageSize: 25 });
      }
    },
    async record(request, response) {
      const path = new URL(request.url).pathname;
      if (!response.ok) return;
      if (path === '/api/news') {
        const { stories } = await response.clone().json();
        transaction(() => {
          for (const story of stories) {
            addHeadline.run(story.href, story.time, story.source, story.title, story.scores[0].label, story.scores[0].score);
          }
        });
      } else if (path === '/api/analyze' && request.headers.get('origin') === origin) {
        const user = userFor(request);
        if (!user) return;
        const { text } = await request.json();
        const { scores } = await response.clone().json();
        addAnalysis.run(user.id, Date.now(), text, scores[0].label, scores[0].score);
      }
    },
  };
}
