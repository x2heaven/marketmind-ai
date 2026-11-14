const freshness = 180;
let newsInFlight;
let lastNews;
let lastRefresh = 0;

function features(text) {
  const words = text.replace(/https?:\/\/\S+/gi, '').replace(/\$[A-Z0-9]{1,10}\b/g, '')
    .toLowerCase().match(/[a-z]{2,}/g) ?? [];
  return new Set(words.flatMap((word, i) => i ? [word, words[i - 1] + ' ' + word] : [word]));
}

function predict(text) {
  const logits = [...model.bias];
  for (const word of features(text)) {
    if (!Object.hasOwn(model.weights, word)) continue;
    const weight = model.weights[word];
    for (let i = 0; i < logits.length; i++) logits[i] += weight[i];
  }
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return model.labels.map((label, i) => ({ label, score: exps[i] / sum }))
    .sort((a, b) => b.score - a.score);
}

function json(data, status = 200, cache = 'no-store') {
  return Response.json(data, { status, headers: { 'Cache-Control': cache } });
}

async function readPublisher([source, url]) {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    if (!/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error('Invalid feed');
    const stories = parseFeed(xml, source);
    return { source, stories, status: stories.length ? 'active' : 'quiet' };
  } catch { return { source, stories: [], status: 'unavailable' }; }
}

async function collectNews() {
  const results = await Promise.all(Object.entries(feeds).map(readPublisher));
  const stories = mergeStories(results.map((result) => result.stories))
    .map((story) => ({ ...story, scores: predict(story.title) }));
  const sources = results.map(({ source, stories, status }) => ({ name: source, count: stories.length, status, url: feeds[source] }));
  return { stories, sources, updatedAt: Date.now() };
}

async function getNews(request, context) {
  const key = new Request(new URL('/api/news', request.url), { method: 'GET' });
  const cache = globalThis.caches?.default;
  const cached = await cache?.match(key).catch(() => undefined);
  if (cached) return cached;
  if (lastNews && Date.now() - lastRefresh < freshness * 1000) return json(lastNews);
  newsInFlight ??= collectNews().finally(() => { newsInFlight = undefined; });
  const fresh = await newsInFlight;
  if (!fresh.stories.length) {
    if (lastNews) return json({ ...lastNews, stale: true });
    return json(fresh, 503);
  }
  lastNews = fresh;
  lastRefresh = Date.now();
  const response = json(fresh, 200, `public, max-age=${freshness}`);
  if (cache && context?.waitUntil) context.waitUntil(cache.put(key, response.clone()).catch(() => {}));
  return response;
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const page = pages[url.pathname];
    if (page) {
      return new Response(page.text, { headers: { 'Content-Type': page.mime + '; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }
    if (Object.hasOwn(icons, url.pathname)) {
      return new Response(Uint8Array.from(atob(icons[url.pathname]), (char) => char.charCodeAt(0)), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' },
      });
    }
    if (url.pathname === '/api/news' && request.method === 'GET') return getNews(request, context);
    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      const length = Number(request.headers.get('content-length'));
      if (length > 4000) return json({ error: 'Headline is too long' }, 413);
      let text;
      try { text = (await request.json()).text; } catch { /* Invalid request body. */ }
      if (typeof text !== 'string' || !text.trim() || text.length > 600) return json({ error: 'Enter a headline up to 600 characters' }, 400);
      return json({ scores: predict(text) });
    }
    return new Response('Not found', { status: 404 });
  },
};
