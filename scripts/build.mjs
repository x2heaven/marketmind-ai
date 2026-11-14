import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

const read = (path, encoding) => readFile(new URL(path, import.meta.url), encoding);
const webFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
const pages = {};
for (const [route, [name, mime]] of Object.entries(webFiles)) {
  pages[route] = { mime, text: await read('../web/' + name, 'utf8') };
}
const icons = {};
for (const name of await readdir(new URL('../assets/', import.meta.url))) {
  if (name.endsWith('.png')) icons['/assets/' + name] = (await read('../assets/' + name)).toString('base64');
}
const model = JSON.parse(await read('../worker/model.json', 'utf8'));
const feedCode = await read('../worker/feeds.mjs', 'utf8');
const workerCode = await read('../worker/index.mjs', 'utf8');
const files = `const pages = ${JSON.stringify(pages)};\nconst icons = ${JSON.stringify(icons)};\nconst model = ${JSON.stringify(model)};\n`;
await mkdir(new URL('../dist/server/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/server/index.js', import.meta.url), files + feedCode + '\n' + workerCode);
console.log('Built MarketMind AI Worker');
