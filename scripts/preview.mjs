import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import worker from '../dist/server/index.js';

const origin = 'http://127.0.0.1:4173';
createServer(async (input, output) => {
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
}).listen(4173, '127.0.0.1', () => console.log(origin));
