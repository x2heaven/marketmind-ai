import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import worker from '../dist/server/index.js';

const host = '127.0.0.1';
const port = 4173;
const origin = `http://${host}:${port}`;
const server = createServer(async (input, output) => {
  try {
    const body = input.method === 'POST' ? Readable.toWeb(input) : undefined;
    const result = await worker.fetch(new Request(new URL(input.url, origin), {
      method: input.method, headers: input.headers, body, ...(body && { duplex: 'half' }),
    }));
    output.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body) Readable.fromWeb(result.body).pipe(output);
    else output.end();
  } catch (error) {
    console.error(error);
    output.writeHead(500).end();
  }
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Close the existing local server and try again.`
    : error.message);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`MarketMind AI is ready at ${origin}`);
  if (process.platform !== 'win32' || !process.argv.includes('--open')) return;
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', origin], {
    stdio: 'ignore', windowsHide: true,
  });
  browser.on('error', () => console.log(`Open ${origin} in your browser.`));
  browser.unref();
});
