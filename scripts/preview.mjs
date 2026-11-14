import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import worker from '../dist/server/index.js';
import { openLocalData } from './local-data.mjs';

const host = '127.0.0.1';
const port = Number(process.env.MARKETMIND_PORT ?? 4173);
const origin = `http://${host}:${port}`;
const local = openLocalData(origin);
const server = createServer(async (input, output) => {
  try {
    if (input.headers.host !== `${host}:${port}`) {
      if (input.headers.host === `localhost:${port}` && input.method === 'GET' && input.url === '/') {
        output.writeHead(302, { Location: origin }).end();
      } else output.writeHead(400).end('Use ' + origin);
      return;
    }
    let body;
    if (input.method === 'POST') {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of input) {
        bytes += chunk.length;
        if (bytes > 8000) break;
        chunks.push(chunk);
      }
      if (bytes > 8000) {
        output.writeHead(413).end();
        return;
      }
      body = Buffer.concat(chunks);
    }
    if (!input.url?.startsWith('/') || input.url.startsWith('//')) {
      output.writeHead(400).end();
      return;
    }
    const request = new Request(origin + input.url, {
      method: input.method, headers: input.headers, body, ...(body && { duplex: 'half' }),
    });
    const localResult = await local.route(request);
    const result = localResult ?? await worker.fetch(request.clone());
    if (!localResult) await local.record(request, result);
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
  if (local.setupCode) console.log(`Admin setup code: ${local.setupCode}`);
  if (process.platform !== 'win32' || !process.argv.includes('--open')) return;
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', origin], {
    stdio: 'ignore', windowsHide: true,
  });
  browser.on('error', () => console.log(`Open ${origin} in your browser.`));
  browser.unref();
});
