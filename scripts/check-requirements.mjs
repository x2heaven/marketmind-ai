import { execFile } from 'node:child_process';
import { access, constants, mkdtemp, open, readFile, readdir, rmdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = new URL('../', import.meta.url);
const quick = process.argv.includes('--quick');
const port = Number(process.env.MARKETMIND_PORT ?? 4173);
const run = promisify(execFile);
let failures = 0;
let warnings = 0;

function report(level, message) {
  console.log(`[${level}] ${message}`);
  if (level === 'FAIL') failures++;
  if (level === 'WARN') warnings++;
}

async function check(level, action) {
  try { report('OK', await action()); }
  catch (error) { report(level, error.message); }
}

async function testWrites(folder) {
  try {
    const probe = await mkdtemp(fileURLToPath(new URL('.marketmind-check-', folder)));
    await rmdir(probe);
  } catch {
    throw new Error(`Cannot write to ${fileURLToPath(folder)}. Move the project to a writable folder.`);
  }
}

async function testPort() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MARKETMIND_PORT must be a port between 1 and 65535.');
  }
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
    });
  } catch (error) {
    throw new Error(error.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. If MarketMind AI is running, close its server window before starting another copy.`
      : `Cannot listen on port ${port} (${error.code ?? error.message}).`);
  }
  await new Promise((resolve) => server.close(resolve));
  return `Port ${port} is free for the local server.`;
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    await response.body?.cancel();
    return response.ok;
  } catch { return false; }
}

async function pythonStatus() {
  let pythonFound = false;
  for (const [command, args] of [['py', ['-3']], ['python', []]]) {
    const options = { timeout: 5000, windowsHide: true };
    const version = await run(command, [...args, '--version'], options).catch(() => null);
    if (!version) continue;
    const interpreter = (version.stdout || version.stderr).trim();
    const match = interpreter.match(/^Python 3\.(\d+)/);
    if (!match) continue;
    pythonFound = true;
    if (Number(match[1]) < 11) continue;
    const result = await run(command, [...args, '-c',
      'from importlib.metadata import version; import sklearn; print(version("scikit-learn"))'], options).catch(() => null);
    if (result) return report('OK', `Optional training: ${interpreter}, scikit-learn ${result.stdout.trim()}.`);
    return report('INFO', 'Optional training: Python found. Install scikit-learn with python -m pip install -r requirements.txt.');
  }
  if (pythonFound) return report('INFO', 'Optional training: Python 3.11 or newer is required.');
  report('INFO', 'Optional training: Python is not available. The site uses the included trained model.');
}

console.log('MarketMind AI requirements check');
await check('FAIL', async () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`Node.js ${process.version} found. Install 22.13 or newer at https://nodejs.org/en/download.`);
  }
  const { DatabaseSync } = await import('node:sqlite').catch(() => {
    throw new Error('Built-in SQLite is unavailable. Use an official Node.js build with node:sqlite enabled.');
  });
  const db = new DatabaseSync(':memory:');
  try { db.prepare('SELECT 1').get(); }
  finally { db.close(); }
  return `Node.js ${process.version} and built-in SQLite are ready.`;
});

await check('FAIL', async () => {
  const files = ['package.json', 'web/index.html', 'web/app.js', 'web/styles.css',
    'scripts/build.mjs', 'scripts/preview.mjs', 'scripts/local-data.mjs', 'worker/feeds.mjs',
    'worker/index.mjs', 'worker/model.json'];
  for (const file of files) {
    await access(new URL(file, root), constants.R_OK).catch(() => {
      throw new Error(`${file} is missing or unreadable. Extract the entire ZIP.`);
    });
  }
  const icons = await readdir(new URL('assets/', root)).catch(() => []);
  if (!icons.some((name) => name.endsWith('.png'))) throw new Error('Coin icons are missing from assets/. Extract the entire ZIP.');
  let model;
  try { model = JSON.parse(await readFile(new URL('worker/model.json', root), 'utf8')); }
  catch { throw new Error('The included sentiment model cannot be read. Extract a fresh copy of the ZIP.'); }
  if (!Array.isArray(model?.labels) || model.labels.length !== 3 || model.bias?.length !== 3 || !Object.keys(model.weights ?? {}).length) {
    throw new Error('The included sentiment model is invalid. Extract a fresh copy of the ZIP.');
  }
  return 'Project files, coin icons, and the trained sentiment model are present.';
});

await check('FAIL', async () => {
  await testWrites(root);
  for (const name of ['dist/', 'dist/server/', 'data/']) {
    const folder = new URL(name, root);
    try { await access(folder); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await testWrites(folder);
  }
  for (const name of ['dist/server/index.js', 'data/marketmind.sqlite']) {
    try { await (await open(new URL(name, root), 'r+')).close(); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`${name} cannot be opened for writing.`);
    }
  }
  return 'Build output and database can be written.';
});
await check('FAIL', testPort);

if (!quick && !failures) {
  const { feeds } = await import('../worker/feeds.mjs').catch(() => ({ feeds: {} }));
  const finbertConfig = 'https://huggingface.co/Xenova/finbert/resolve/main/config.json';
  const browserRuntime = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
  const [kraken, rss, config, runtime] = await Promise.all([
    reachable('https://api.kraken.com/0/public/Time'),
    Promise.all(Object.values(feeds).map(reachable)),
    reachable(finbertConfig),
    reachable(browserRuntime),
  ]);
  const sources = rss.filter(Boolean).length;
  report(kraken ? 'OK' : 'WARN', kraken ? 'Kraken API is reachable.' : 'Kraken API is unreachable. Live prices may be unavailable.');
  report(rss.length && sources === rss.length ? 'OK' : 'WARN', `Publisher feeds reachable: ${sources}/${rss.length} from this computer.`);
  report(config && runtime ? 'OK' : 'WARN', config && runtime
    ? 'FinBERT download endpoints are reachable. The browser downloads the weights on first use.'
    : 'Some FinBERT download endpoints are unreachable. Quick analysis uses the included model.');
  report('INFO', 'Use a current browser with JavaScript enabled. FinBERT also uses WebAssembly.');
  await pythonStatus();
}

if (failures) {
  console.log('\nFix the FAIL items above and run Requirements.bat again.');
  process.exitCode = 1;
} else {
  console.log(warnings
    ? '\nLocal launch is ready. Some online features may be unavailable.'
    : '\nReady to run Start-MarketMind.bat.');
}
