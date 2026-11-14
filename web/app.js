const coins = [
  { symbol: 'BTC', name: 'Bitcoin', pair: 'XBTUSD', ticker: 'XXBTZUSD', icon: '₿', color: '#c7742c' },
  { symbol: 'ETH', name: 'Ethereum', pair: 'ETHUSD', ticker: 'XETHZUSD', icon: '◆', color: '#5d62bc' },
  { symbol: 'SOL', name: 'Solana', pair: 'SOLUSD', icon: '≋', color: '#514698' },
  { symbol: 'XRP', name: 'XRP', pair: 'XRPUSD', ticker: 'XXRPZUSD', icon: '✕', color: '#444667' },
  { symbol: 'DOGE', name: 'Dogecoin', pair: 'DOGEUSD', ticker: 'XDGUSD', icon: 'Ð', color: '#967034' },
  { symbol: 'ADA', name: 'Cardano', pair: 'ADAUSD', icon: '⁙', color: '#3d55af' },
  { symbol: 'LINK', name: 'Chainlink', pair: 'LINKUSD', icon: '⬡', color: '#354fb7' },
  { symbol: 'AVAX', name: 'Avalanche', pair: 'AVAXUSD', icon: '▲', color: '#b95062' },
  { symbol: 'DOT', name: 'Polkadot', pair: 'DOTUSD', icon: '●', color: '#b43977' },
  { symbol: 'TRX', name: 'TRON', pair: 'TRXUSD', icon: '▽', color: '#bf4865' },
  { symbol: 'XLM', name: 'Stellar', pair: 'XLMUSD', ticker: 'XXLMZUSD', icon: '✶', color: '#626782' },
  { symbol: 'SUI', name: 'Sui', pair: 'SUIUSD', icon: '◈', color: '#3676a5' },
  { symbol: 'BCH', name: 'Bitcoin Cash', pair: 'BCHUSD' },
  { symbol: 'LTC', name: 'Litecoin', pair: 'LTCUSD', ticker: 'XLTCZUSD' },
  { symbol: 'XMR', name: 'Monero', pair: 'XMRUSD', ticker: 'XXMRZUSD' },
  { symbol: 'HBAR', name: 'Hedera', pair: 'HBARUSD' },
  { symbol: 'NEAR', name: 'Near Protocol', pair: 'NEARUSD' },
  { symbol: 'UNI', name: 'Uniswap', pair: 'UNIUSD' },
  { symbol: 'AAVE', name: 'Aave', pair: 'AAVEUSD' },
  { symbol: 'ATOM', name: 'Cosmos', pair: 'ATOMUSD' },
  { symbol: 'ARB', name: 'Arbitrum', pair: 'ARBUSD' },
  { symbol: 'APT', name: 'Aptos', pair: 'APTUSD' },
  { symbol: 'OP', name: 'Optimism', pair: 'OPUSD' },
];
const kraken = 'https://api.kraken.com/0/public/';
const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const entrances = new WeakMap();
const easing = 'cubic-bezier(.2, .65, .3, 1)';
const state = {
  quotes: new Map(),
  stories: [],
  publishers: [],
  newsUpdated: null,
  hours: 24,
  visible: 6,
  page: 'overview',
  sources: {},
  details: null,
};
const localAccount = { available: false, user: null, setupRequired: false, mode: 'login', tablePage: 1 };
let classifierPromise;
let inferenceQueue = Promise.resolve();
const transformersUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';
const aliases = {
  BTC: /\b(?:bitcoin(?!\s+cash)|btc|xbt)\b/i,
  ETH: /\b(?:ethereum|ether|eth)\b/i,
  DOGE: /\b(?:dogecoin|doge)\b/i,
  SUI: /\bSUI\b|\bSui\b/,
  NEAR: /\bNEAR\b|\b[Nn]ear [Pp]rotocol\b/,
  OP: /\bOP\b|\b[Oo]ptimism (?:network|token|mainnet)\b/,
  XLM: /\bXLM\b|\bStellar(?: Lumens| network)?\b/,
  ATOM: /\bATOM\b|\bCosmos(?: Hub| chain)?\b/,
};
const assetPatterns = coins.map((coin) => {
  const name = coin.symbol === coin.name ? null : new RegExp(`\\b${coin.name}\\b`, 'i');
  const ticker = new RegExp(`\\b${coin.symbol}\\b`);
  return { coin, matches: (headline) => aliases[coin.symbol]?.test(headline) ?? (name?.test(headline) || ticker.test(headline)) };
});

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function reveal(element, offset = 4, duration = 250) {
  entrances.get(element)?.cancel();
  if (reducedMotion.matches || element.closest('[hidden]')) return;
  entrances.set(element, element.animate([
    { opacity: .76, translate: `0 ${offset}px` },
    { opacity: 1, translate: '0 0' },
  ], { duration, easing }));
}

function coinIcon(coin) {
  const icon = node('span', 'coin-icon');
  const image = node('img');
  image.src = `/assets/${coin.symbol.toLowerCase()}.png`;
  image.alt = '';
  image.draggable = false;
  image.addEventListener('error', () => { icon.textContent = coin.icon ?? coin.symbol.slice(0, 1); }, { once: true });
  icon.append(image);
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function change(value) {
  return node('span', `change ${value >= 0 ? 'positive' : 'negative'}`, `${value > 0 ? '+' : ''}${value.toFixed(2)}%`);
}

function dollars(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function label(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function age(timestamp) {
  const hours = Math.floor((Date.now() - timestamp) / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function fetchSource(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Source responded with ${response.status}`);
  return response;
}

async function fetchKraken(endpoint) {
  const [method, query] = endpoint.split('?');
  const route = localAccount.available
    ? '/api/local/market?' + new URLSearchParams({ endpoint: method, pair: new URLSearchParams(query).get('pair') })
    : kraken + endpoint;
  const { error, result } = await (await fetchSource(route)).json();
  if (error.length || !result) throw new Error(error.join(', ') || 'No market data');
  return result;
}

async function getQuotes() {
  const tickers = await fetchKraken(`Ticker?pair=${coins.map((coin) => coin.pair).join(',')}`);
  return new Map(coins.flatMap((coin) => {
    const ticker = tickers[coin.ticker ?? coin.pair];
    if (!ticker) return [];
    const price = Number(ticker.c[0]);
    const open = Number(Array.isArray(ticker.o) ? ticker.o[0] : ticker.o);
    if (!Number.isFinite(price) || !Number.isFinite(open) || open <= 0) return [];
    return [[coin.symbol, { coin, price, change: (price / open - 1) * 100 }]];
  }));
}

async function getStories() {
  const response = await fetch('/api/news', { signal: AbortSignal.timeout(15_000) });
  const { stories, sources, updatedAt, stale } = await response.json();
  state.publishers = sources;
  state.newsUpdated = updatedAt;
  renderPublishers();
  if (!response.ok) throw new Error('Publishers unavailable');
  state.stories = stories.map((story) => ({
    ...story, assets: assetPatterns.filter(({ matches }) => matches(story.title)).map(({ coin }) => coin),
  }));
  return !stale;
}

function getClassifier() {
  if (!classifierPromise) {
    classifierPromise = import(transformersUrl + 'transformers.min.js')
      .then(({ pipeline, env }) => {
        env.allowLocalModels = false;
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.wasmPaths = transformersUrl;
        return pipeline('text-classification', 'Xenova/finbert', {
          device: 'wasm',
          dtype: 'q8',
          progress_callback(progress) {
            if (progress.status !== 'progress' || !progress.file.endsWith('.onnx')) return;
            const percentage = Math.round(progress.progress);
            if (!Number.isFinite(percentage)) return;
            const message = percentage < 100 ? `Downloading FinBERT · ${percentage}%` : 'Starting FinBERT…';
            if ($('analysis-result').textContent !== message) $('analysis-result').textContent = message;
          },
        });
      })
      .catch((error) => {
        classifierPromise = undefined;
        throw error;
      });
  }
  return classifierPromise;
}

function classify(text, classifier) {
  const result = inferenceQueue.then(() => classifier(text, { top_k: 3, truncation: true }));
  inferenceQueue = result.catch(() => {});
  return result;
}

function renderQuotes({ animate = true, updateTable = true } = {}) {
  const positions = [
    [49, 49, 38], [16, 22, 28], [80, 77, 27], [79, 20, 24],
    [32, 83, 22], [13, 57, 19], [82, 47, 18], [48, 13, 16],
    [59, 87, 15], [9, 79, 14], [94, 33, 12], [94, 60, 12],
  ];
  const direction = $('mover-mode').value;
  const quotes = [...state.quotes.values()];
  const movers = quotes.filter(({ change }) => direction === 'all' || (direction === 'positive' ? change > 0 : change < 0))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, positions.length);
  $('bubbles').replaceChildren(...movers.map((quote, index) => {
    const [x, y, size] = positions[index];
    const button = node('button', `bubble${quote.change < 0 ? ' loss' : ''}`);
    button.type = 'button';
    button.style.setProperty('--x', `${x}%`);
    button.style.setProperty('--y', `${y}%`);
    const ratio = Math.sqrt(Math.abs(quote.change) / (Math.abs(movers[0].change) || 1));
    button.style.setProperty('--size', `${size * (.79 + .21 * ratio)}%`);
    button.style.setProperty('--delay', `${index * -0.43}s`);
    button.setAttribute('aria-label', `${quote.coin.name}, ${quote.change.toFixed(2)} percent, view details`);
    button.append(coinIcon(quote.coin), node('span', 'symbol', quote.coin.symbol), change(quote.change));
    button.addEventListener('click', () => showCoin(quote.coin));
    return button;
  }));
  if (!movers.length) {
    const message = quotes.length ? 'No coins match this filter.' : state.sources.quotes === false ? 'Kraken prices are unavailable.' : 'Loading prices…';
    $('bubbles').append(node('p', 'empty', message));
  }
  if (animate) reveal($('bubbles'));
  if (!updateTable) return;
  $('coin-table').replaceChildren(...quotes.map((quote) => {
    const button = node('button', 'coin-table-row');
    const asset = node('span', 'asset-name');
    asset.append(coinIcon(quote.coin), node('strong', '', quote.coin.symbol), node('span', 'coin-name', quote.coin.name));
    button.type = 'button';
    button.append(asset, node('span', 'quote-number', dollars(quote.price)), change(quote.change));
    button.addEventListener('click', () => showCoin(quote.coin));
    return button;
  }));
  if (!quotes.length) $('coin-table').append(node('p', 'empty', state.sources.quotes === false ? 'Kraken prices are unavailable.' : 'Loading prices…'));
  if (animate) reveal($('coin-table'));
}

function renderFear(index) {
  $('fear-marker').hidden = !index;
  $('fear-value').textContent = index?.value ?? '—';
  $('fear-label').textContent = index?.description ?? (state.sources.news === undefined ? 'Analyzing headlines…' : 'No headlines to score');
  $('fear-label').className = index ? `fear-label ${signalClass(index.value)}` : 'fear-label';
  if (index) $('fear-marker').style.setProperty('--position', `${index.value}%`);
}

function signalClass(score) {
  if (score >= 60) return 'positive';
  if (score <= 40) return 'negative';
  return 'neutral';
}

function windowStories(now = Date.now()) {
  return state.stories.filter(({ time }) => time >= now - state.hours * 3_600_000);
}

function sentimentScore(stories) {
  const scores = stories.map(({ scores }) => scores);
  if (!scores.length) return { count: 0, value: null };
  const total = scores.reduce((sum, prediction) => {
    const positive = prediction.find(({ label }) => label === 'positive').score;
    const negative = prediction.find(({ label }) => label === 'negative').score;
    return sum + (1 + positive - negative) / 2;
  }, 0);
  return { count: scores.length, value: Math.round(100 * total / scores.length) };
}

function drawGauge(value, filled = value ?? 0) {
  const ctx = $('gauge-canvas').getContext('2d');
  ctx.clearRect(0, 0, 560, 270);
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  const colors = value === null ? [] : ({
    positive: ['#665dfa', '#73d3fc'],
    neutral: ['#8270ef', '#d5a7ed'],
    negative: ['#9867ff', '#ed92c7'],
  })[signalClass(value)];
  const gradient = ctx.createLinearGradient(65, 240, 480, 45);
  colors.forEach((color, index) => gradient.addColorStop(index, color));
  for (let i = 0; i < 37; i += 1) {
    const angle = Math.PI + (i / 36) * Math.PI;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    ctx.strokeStyle = i < Math.round(filled * .37) ? gradient : '#55516d';
    ctx.beginPath();
    ctx.moveTo(280 + 194 * x, 247 + 194 * y);
    ctx.lineTo(280 + 223 * x, 247 + 223 * y);
    ctx.stroke();
  }
}

let gaugeFrame;
let gaugeValue = 0;
let gaugeTarget;
function updateGauge(value) {
  if (value === gaugeTarget) return;
  gaugeTarget = value;
  cancelAnimationFrame(gaugeFrame);
  const canvas = $('gauge-canvas');
  const start = gaugeValue;
  const target = value ?? 0;
  if (reducedMotion.matches || canvas.closest('[hidden]') || value === null || start === target) {
    gaugeValue = target;
    drawGauge(value);
    return;
  }
  const begin = performance.now();
  const step = (time) => {
    const progress = Math.max(0, Math.min((time - begin) / 320, 1));
    gaugeValue = start + (target - start) * (1 - (1 - progress) ** 3);
    drawGauge(value, gaugeValue);
    if (progress < 1 && !reducedMotion.matches) gaugeFrame = requestAnimationFrame(step);
    else if (progress < 1) {
      gaugeValue = target;
      drawGauge(value);
    }
  };
  gaugeFrame = requestAnimationFrame(step);
}

function renderSentiment() {
  const now = Date.now();
  const stories = windowStories(now);
  const { count, value } = sentimentScore(stories);
  const tone = value === null ? '' : signalClass(value);
  updateGauge(value);
  $('sentiment-value').textContent = value ?? '—';
  $('sentiment-label').textContent = tone ? label(tone) : state.sources.news === undefined ? 'Loading' : 'No score';
  $('sentiment-label').className = tone;
  let message = `${count} analyzed · ${new Set(stories.map(({ source }) => source)).size} publishers · 50 is neutral`;
  if (!stories.length) message = state.sources.news === false ? 'News feed unavailable' : 'No headlines in this period';
  if (state.sources.news === undefined) message = 'Collecting publisher feeds…';
  else if (state.sources.news === false && count) message += ' · Cached feed';
  $('sentiment-caption').textContent = message;

  const assets = coins.map((coin) => ({ coin, ...sentimentScore(stories.filter((story) => story.assets.includes(coin))) }))
    .sort((a, b) => b.count - a.count || Math.abs(b.value - 50) - Math.abs(a.value - 50))
    .slice(0, state.page === 'overview' ? 6 : coins.length);
  $('asset-list').replaceChildren(...assets.map(({ coin, count: mentions, value: score }) => {
    const row = node('button', 'asset-row');
    row.type = 'button';
    const name = node('span', 'asset-name');
    name.append(node('strong', '', coin.symbol), node('span', 'coin-name', coin.name));
    const signal = node('span', 'asset-signal');
    if (score === null) signal.append(node('small', '', 'No coverage'));
    else {
      const tone = signalClass(score);
      const meter = node('span', `mini-meter ${tone}`);
      meter.style.setProperty('--score', `${score}%`);
      meter.setAttribute('aria-hidden', 'true');
      signal.append(meter, node('strong', tone, `${score}`), node('small', '', `${mentions} article${mentions === 1 ? '' : 's'}`));
    }
    row.append(coinIcon(coin), name, signal);
    row.addEventListener('click', () => showCoin(coin));
    return row;
  }));
  const distribution = ['positive', 'neutral', 'negative'].map((tone) => {
    const total = stories.filter(({ scores }) => scores[0].label === tone).length;
    const row = node('div', 'breakdown-row');
    const bar = node('progress', tone);
    bar.max = stories.length || 1;
    bar.value = total;
    bar.setAttribute('aria-label', label(tone));
    row.append(node('span', tone, label(tone)), bar, node('strong', '', String(total)));
    return row;
  });
  $('breakdown').replaceChildren(...distribution);
  renderAiInsights(stories, now);
}

function renderAiInsights(stories, now) {
  const groups = { positive: [], neutral: [], negative: [] };
  for (const story of stories) groups[story.scores[0].label].push(story);
  const { positive, neutral, negative } = groups;
  const pulse = stories.length ? Math.round(50 + 50 * (positive.length - negative.length) / stories.length) : null;
  const tones = { negative: 'Bearish headlines', neutral: 'Mixed headline tone', positive: 'Bullish headlines' };
  renderFear(pulse === null ? null : { value: pulse, description: tones[signalClass(pulse)] });
  $('brief-summary').textContent = stories.length
    ? `${positive.length} positive · ${neutral.length} neutral · ${negative.length} negative · strongest model signals below`
    : state.sources.news === undefined ? 'Waiting for classified headlines…' : 'No classified headlines in this period.';
  $('brief-results').replaceChildren(...[negative, positive].flatMap((group) =>
    [...group].sort((a, b) => b.scores[0].score - a.scores[0].score).slice(0, 2).map(storyCard)));

  if (state.page !== 'sentiment') return;
  const midpoint = now - state.hours * 1_800_000;
  const shifts = coins.flatMap((coin) => {
    const mentions = stories.filter((story) => story.assets.includes(coin));
    const earlier = sentimentScore(mentions.filter(({ time }) => time < midpoint));
    const recent = sentimentScore(mentions.filter(({ time }) => time >= midpoint));
    return recent.count >= 3 && earlier.count >= 3 ? [{ coin, earlier, recent, delta: recent.value - earlier.value }] : [];
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  $('shifts-caption').textContent = `Latest ${state.hours / 2} hours vs. preceding ${state.hours / 2} hours · minimum 3 headlines each`;
  const cards = shifts.slice(0, 6).map(({ coin, earlier, recent, delta }) => {
    const button = node('button', 'asset-row shift-card');
    button.type = 'button';
    const details = node('span', 'shift-details');
    details.append(node('strong', '', coin.name), node('small', '', `${earlier.value} → ${recent.value} · ${earlier.count + recent.count} articles`));
    button.append(coinIcon(coin), details, node('strong', delta > 0 ? 'positive' : delta < 0 ? 'negative' : '', `${delta > 0 ? '+' : ''}${delta} pts`));
    button.addEventListener('click', () => showCoin(coin));
    return button;
  });
  $('shift-results').replaceChildren(...(cards.length ? cards : [node('p', 'empty', 'Too few headlines to measure a shift.')]));
}

function storyCard(story) {
  const result = story.scores[0];
  const card = node('article', 'story');
  const header = node('header');
  const publisher = node('span', 'publisher-name');
  publisher.append(node('span', 'publisher-dot', story.source.slice(0, 1)), node('span', '', story.source));
  header.append(publisher);
  const tag = node('span', `tag ${result.label}`, label(result.label));
  header.append(tag);
  const link = node('a', '', story.title);
  link.href = story.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const heading = node('h3');
  heading.append(link);
  const timestamp = node('time', 'story-meta', [age(story.time), ...story.assets.map(({ symbol }) => symbol)].join(' · '));
  timestamp.dateTime = new Date(story.time).toISOString();
  card.append(header, heading, timestamp);
  return card;
}

function renderNews({ animate = false, append = false } = {}) {
  const filter = $('news-filter').value;
  const publisher = $('source-filter').value;
  const query = $('news-search').value.trim().toLowerCase();
  const all = windowStories();
  const stories = all.filter((story) => (
    (filter === 'all' || story.scores[0].label === filter) &&
    (publisher === 'all' || story.source === publisher) &&
    (!query || story.title.toLowerCase().includes(query) || story.assets.some(({symbol}) => symbol.toLowerCase() === query))
  ));
  const publications = new Set(all.map(({ source }) => source)).size;
  $('news-caption').textContent = all.length ? `${stories.length} headlines · ${publications} publishers in this period` : 'Live publisher feeds';
  const grid = $('news-grid');
  append = append && [...grid.children].every((card, index) => card.querySelector('a')?.href === stories[index]?.href);
  const cards = stories.slice(append ? grid.childElementCount : 0, state.visible).map(storyCard);
  if (append) {
    grid.append(...cards);
    for (const card of cards) reveal(card);
  } else grid.replaceChildren(...cards);
  $('more-news').hidden = stories.length <= state.visible;
  if (!stories.length) {
    let message = 'No matching headlines in this period.';
    if (state.sources.news === false) message = 'News feed is unavailable. Try refreshing.';
    else if (state.sources.news === undefined) message = 'Loading headlines…';
    grid.append(node('p', 'empty', message));
  }
  if (animate) reveal(grid);
}

function renderHeadlineData(animate = false) {
  renderSentiment();
  renderNews({ animate });
  if (animate) {
    reveal($('asset-list'));
    reveal($('breakdown'));
  }
  if (state.details) renderCoinNews(state.details.coin);
}

function renderPublishers() {
  const select = $('source-filter');
  const previous = select.value;
  const all = node('option', '', 'All publishers');
  all.value = 'all';
  select.replaceChildren(all, ...state.publishers.map(({ name }) => {
    const option = node('option', '', name);
    option.value = name;
    return option;
  }));
  if ([...select.options].some(({ value }) => value === previous)) select.value = previous;
  const available = state.publishers.filter(({status}) => status !== 'unavailable').length;
  $('source-caption').textContent = `${available} of ${state.publishers.length} feeds reachable · Checked ${age(state.newsUpdated).toLowerCase()}`;
  $('source-list').replaceChildren(...state.publishers.map(({ name, count, status, url }) => {
    const link = node('a', 'source-card');
    link.href = url;
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    link.append(node('strong', '', name), node('span', status === 'active' ? 'positive' : 'muted',
      status === 'active' ? `${count} recent headlines` : status === 'quiet' ? 'No recent headlines' : 'Feed unavailable'));
    return link;
  }));
}

async function refresh() {
  $('refresh').disabled = true;
  const badge = $('live-status');
  badge.dataset.state = '';
  badge.lastElementChild.textContent = 'Connecting';
  const tasks = [
    ['quotes', getQuotes, (quotes) => { state.quotes = quotes; renderQuotes(); }],
    ['news', getStories, () => renderHeadlineData(true)],
  ];
  let completed = 0;
  await Promise.all(tasks.map(async ([key, fetchData, render]) => {
    try {
      const data = await fetchData();
      state.sources[key] = key === 'news' ? data : true;
      render(data);
    } catch (error) {
      state.sources[key] = false;
      console.error(`Unable to refresh ${key}`, error);
      if (key === 'quotes' && !state.quotes.size) renderQuotes();
      if (key === 'news') renderHeadlineData();
    } finally {
      completed++;
      $('boot-bar').style.setProperty('--progress', `${completed * 100 / tasks.length}%`);
      $('boot-status').textContent = completed === tasks.length ? 'Opening dashboard…' : `Connecting to market data · ${completed} of ${tasks.length}`;
    }
  }));
  const active = Object.values(state.sources).filter(Boolean).length;
  badge.dataset.state = active === tasks.length ? 'live' : active ? 'partial' : 'offline';
  badge.lastElementChild.textContent = active === tasks.length ? 'Live sources' : active ? 'Partial feed' : 'Sources offline';
  $('refresh').disabled = false;
}

const chartDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
let chartData;

function drawPrice(candles) {
  const values = candles.map((row) => ({ time: (Number(row[0]) + 3600) * 1000, price: Number(row[4]) }))
    .filter(({ time, price }) => Number.isFinite(time) && Number.isFinite(price));
  if (values.length < 2) throw new Error('No price history');
  const low = Math.min(...values.map(({ price }) => price));
  const high = Math.max(...values.map(({ price }) => price));
  const span = high - low;
  chartData = {
    points: values.map((value, index) => ({
      ...value, x: 24 + 850 * index / (values.length - 1), y: span ? 267 - (value.price - low) / span * 215 : 159,
    })),
    active: -1,
  };
  paintPrice();
  $('coin-chart-caption').textContent = `${values.length} hourly closes · ${dollars(low)} – ${dollars(high)} · UTC`;
}

function paintPrice() {
  const ctx = $('coin-chart').getContext('2d');
  const { points, active } = chartData;
  ctx.clearRect(0, 0, 900, 320);
  ctx.strokeStyle = '#454058';
  ctx.lineWidth = 1;
  for (const y of [52, 123, 195, 267]) {
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(874, y);
    ctx.stroke();
  }
  const trace = () => {
    ctx.beginPath();
    points.forEach(({ x, y }, i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  };
  const gradient = ctx.createLinearGradient(0, 40, 0, 286);
  gradient.addColorStop(0, '#8874f892');
  gradient.addColorStop(1, '#8874f800');
  trace();
  ctx.lineTo(874, 286);
  ctx.lineTo(24, 286);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  trace();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#bba9ff';
  ctx.stroke();
  const point = points[active];
  if (!point) return;
  ctx.strokeStyle = '#c1b6f2aa';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(point.x, 38);
  ctx.lineTo(point.x, 286);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 7, 0, 2 * Math.PI);
  ctx.fillStyle = '#e6dcff';
  ctx.fill();
}

function selectChartPoint(index) {
  if (!chartData || index === chartData.active) return;
  chartData.active = index;
  const point = chartData.points[index];
  const tooltip = $('coin-tooltip');
  tooltip.hidden = !point;
  if (point) {
    const date = new Date(point.time);
    $('coin-tooltip-time').dateTime = date.toISOString();
    $('coin-tooltip-time').textContent = chartDate.format(date) + ' UTC';
    $('coin-tooltip-price').textContent = dollars(point.price);
    tooltip.style.setProperty('--point', `${point.x / 9}%`);
  }
  paintPrice();
}

function renderCoinNews(coin) {
  const stories = windowStories().filter((story) => story.assets.includes(coin));
  const { value, count } = sentimentScore(stories);
  $('coin-sentiment').textContent = count ? `Headline sentiment ${value} / 100 · ${count} articles in ${state.hours === 24 ? '24 hours' : '7 days'}` : 'Headline sentiment · No coverage in this period';
  $('coin-news').replaceChildren(...stories.slice(0, 6).map(storyCard));
  if (!stories.length) $('coin-news').append(node('p', 'empty', 'No matching headlines in the selected period.'));
}

async function showCoin(coin) {
  const request = { coin };
  state.details = request;
  const quote = state.quotes.get(coin.symbol);
  const dialog = $('coin-dialog');
  $('coin-title').textContent = `${coin.name} · ${coin.symbol}`;
  $('coin-summary').replaceChildren(quote ? dollars(quote.price) + ' · ' : '');
  if (quote) $('coin-summary').append(change(quote.change), ' today (UTC)');
  const chart = $('coin-chart');
  chartData = null;
  $('coin-tooltip').hidden = true;
  $('coin-chart-frame').hidden = false;
  chart.hidden = false;
  chart.classList.add('is-loading');
  $('coin-chart-caption').textContent = 'Loading hourly prices…';
  renderCoinNews(coin);
  if (!dialog.open) dialog.showModal();
  try {
    const result = await fetchKraken(`OHLC?pair=${coin.pair}&interval=60`);
    if (state.details !== request) return;
    const candles = Object.entries(result).find(([key]) => key !== 'last')?.[1].slice(-25, -1);
    if (!candles || candles.length < 2) throw new Error('No price history');
    drawPrice(candles);
    chart.classList.remove('is-loading');
    reveal(chart, 3);
  } catch {
    if (state.details === request) {
      $('coin-chart-frame').hidden = true;
      $('coin-chart-caption').textContent = 'Hourly prices are unavailable.';
    }
  }
}

const chart = $('coin-chart');
function pointAtPointer(event) {
  if (!chartData) return;
  const rect = chart.getBoundingClientRect();
  const relative = ((event.clientX - rect.left) / rect.width * chart.width - 24) / 850;
  const index = Math.round(Math.max(0, Math.min(1, relative)) * (chartData.points.length - 1));
  selectChartPoint(index);
}
chart.addEventListener('pointermove', pointAtPointer);
chart.addEventListener('pointerdown', pointAtPointer);
chart.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') selectChartPoint(-1); });
chart.addEventListener('keydown', (event) => {
  if (!chartData || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const last = chartData.points.length - 1;
  let index = chartData.active + (event.key === 'ArrowLeft' ? -1 : 1);
  if (event.key === 'Home') index = 0;
  if (event.key === 'End') index = last;
  selectChartPoint(Math.max(0, Math.min(last, index)));
});
chart.addEventListener('blur', () => selectChartPoint(-1));
document.addEventListener('dragstart', (event) => {
  if (event.target.closest('.shell') && !event.target.closest('input, textarea, .database-scroll')) event.preventDefault();
});

$('refresh').addEventListener('click', refresh);
$('timeframes').addEventListener('click', (event) => {
  const selected = event.target.closest('[data-hours]');
  if (!selected || Number(selected.dataset.hours) === state.hours) return;
  state.hours = Number(selected.dataset.hours);
  state.visible = 6;
  for (const button of $('timeframes').querySelectorAll('button')) button.setAttribute('aria-pressed', button === selected);
  renderHeadlineData(true);
});
const pages = {
  overview: ['Market overview', 'Crypto prices, news, and market sentiment in one place.'],
  coins: ['Coins', 'Explore price movers and live USD quotes from Kraken.'],
  sentiment: ['Market sentiment', 'Explore the balance of positive, neutral, and negative headlines.'],
  news: ['Market news', 'Read across publishers and filter the headlines by sentiment.'],
  sources: ['News sources', 'See which publisher feeds are reachable and how much they cover.'],
  database: ['Database', 'Inspect the records collected by your local server.'],
};
function requestedPage() {
  const hash = window.location.hash.slice(1);
  const allowed = hash !== 'database' || localAccount.user?.role === 'admin';
  return allowed && Object.hasOwn(pages, hash) ? hash : 'overview';
}

function showPage(page = requestedPage()) {
  const workspace = $('workspace');
  if (workspace.dataset.page === page) return;
  const main = $('page-content');
  const hadContentFocus = main.contains(document.activeElement);
  state.page = page;
  state.visible = 6;
  const [title, subtitle] = pages[state.page];
  $('page-title').textContent = title;
  $('page-subtitle').textContent = subtitle;
  workspace.dataset.page = state.page;
  $('timeframes').hidden = ['coins', 'sources', 'database'].includes(state.page);
  $('all-assets').hidden = state.page !== 'overview';
  $('all-news').hidden = state.page !== 'overview';
  for (const panel of document.querySelectorAll('[data-pages]')) panel.hidden = !panel.dataset.pages.split(' ').includes(state.page);
  for (const link of document.querySelectorAll('.topbar nav a')) {
    const selected = link.hash === '#' + state.page;
    link.classList.toggle('is-active', selected);
    if (selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  renderHeadlineData();
  if (page === 'database') loadDatabase();
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (hadContentFocus) main.focus({ preventScroll: true });
}

let leavingPage;
let enteringPage;
async function changePage() {
  const main = $('page-content');
  if (reducedMotion.matches || !main.animate || document.querySelector('dialog[open]')) {
    leavingPage?.cancel();
    enteringPage?.cancel();
    leavingPage = enteringPage = undefined;
    showPage();
    return;
  }
  if (leavingPage || requestedPage() === state.page) return;

  const style = getComputedStyle(main);
  const start = { opacity: style.opacity, transform: style.transform };
  enteringPage?.cancel();
  const exit = main.animate([start, { opacity: 0, transform: 'translateY(-5px)' }], {
    duration: 145, easing: 'cubic-bezier(.4, 0, .7, 1)', fill: 'both',
  });
  leavingPage = exit;
  await exit.finished.catch(() => {});
  if (leavingPage !== exit) return;
  leavingPage = undefined;

  const target = requestedPage();
  const switched = target !== state.page;
  showPage(target);
  exit.cancel();
  if (reducedMotion.matches) return;
  const entrance = main.animate([
    { opacity: 0, transform: `translateY(${switched ? 9 : -5}px)` },
    { opacity: 1, transform: 'none' },
  ], { duration: 355, easing: 'cubic-bezier(.16, 1, .3, 1)' });
  enteringPage = entrance;
  await entrance.finished.catch(() => {});
  if (enteringPage === entrance) enteringPage = undefined;
}
window.addEventListener('hashchange', changePage);
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) changePage();
});
for (const [id, event] of [['news-filter', 'change'], ['source-filter', 'change'], ['news-search', 'input']]) {
  $(id).addEventListener(event, () => {
    state.visible = 6;
    renderNews({ animate: event === 'change' });
  });
}
$('more-news').addEventListener('click', () => { state.visible += 12; renderNews({ append: true }); });
$('mover-mode').addEventListener('change', () => renderQuotes({ updateTable: false }));
$('open-analysis').addEventListener('click', () => $('analysis-dialog').showModal());
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
});
$('coin-dialog').addEventListener('close', () => { state.details = null; });

const localApi = '/api/local/';
function renderAccount() {
  const { available, user, setupRequired, mode } = localAccount;
  $('open-account').hidden = !available;
  $('open-account').textContent = user?.username ?? 'Account';
  const admin = user?.role === 'admin';
  $('admin-link').hidden = !admin;
  $('account-database').hidden = !admin;
  $('account-form').hidden = Boolean(user);
  $('account-modes').hidden = Boolean(user);
  $('account-actions').hidden = !user;
  $('account-email-form').hidden = !user || Boolean(user.email);
  $('account-hint').textContent = user
    ? [`Signed in as ${user.username}`, user.email, user.role].filter(Boolean).join(' · ')
    : setupRequired ? 'Use Set up admin to unlock the database.' : 'Accounts are stored on this computer.';
  const buttons = $('account-modes').querySelectorAll('button');
  for (const button of buttons) {
    button.setAttribute('aria-pressed', button.dataset.action === mode);
    if (button.dataset.action === 'setup') button.hidden = !setupRequired;
  }
  const setup = mode === 'setup';
  const creating = mode !== 'login';
  for (const [field, caption] of [['account-email', 'email-label'], ['account-confirm', 'confirm-label']]) {
    $(field).hidden = $(field).disabled = $(caption).hidden = !creating;
    $(field).required = creating;
  }
  $('setup-code').hidden = !setup;
  $('setup-code').disabled = !setup;
  $('setup-code').required = setup;
  $('setup-label').hidden = !setup;
  $('account-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('account-submit').textContent = { login: 'Sign in', register: 'Create account', setup: 'Create administrator' }[mode];
}

async function connectAccount() {
  try {
    const response = await fetch(localApi + 'account/session', { signal: AbortSignal.timeout(1500) });
    if (response.ok) Object.assign(localAccount, await response.json());
  } catch { /* Hosted and disconnected previews can use the public dashboard. */ }
  renderAccount();
  showPage();
}

async function accountAction(action, data = {}) {
  const response = await fetch(localApi + 'account/' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  localAccount.user = result.user;
  if (action === 'setup') localAccount.setupRequired = false;
  localAccount.mode = 'login';
  if (!localAccount.user) {
    $('database-results').replaceChildren();
    if (state.page === 'database') window.location.hash = 'overview';
  }
  renderAccount();
  showPage();
  if (action === 'email' && state.page === 'database') loadDatabase();
}

$('open-account').addEventListener('click', () => {
  $('account-result').textContent = '';
  $('account-dialog').showModal();
});
$('account-modes').addEventListener('click', (event) => {
  const mode = event.target.closest('[data-action]')?.dataset.action;
  if (!mode || mode === localAccount.mode) return;
  localAccount.mode = mode;
  $('account-result').textContent = '';
  renderAccount();
  reveal($('account-form'), 3);
});
$('account-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if ($('account-submit').disabled) return;
  const data = Object.fromEntries(new FormData(form));
  if (localAccount.mode !== 'login' && data.password !== data.confirmPassword) {
    $('account-result').textContent = 'Passwords do not match.';
    $('account-confirm').focus();
    return;
  }
  $('account-submit').disabled = true;
  for (const button of $('account-modes').querySelectorAll('button')) button.disabled = true;
  $('account-result').textContent = '';
  try {
    await accountAction(localAccount.mode, data);
    form.reset();
    $('account-dialog').close();
  } catch (error) {
    $('account-result').textContent = error.message || 'Could not reach the local server.';
  } finally {
    $('account-submit').disabled = false;
    for (const button of $('account-modes').querySelectorAll('button')) button.disabled = false;
  }
});
$('account-email-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  $('save-email').disabled = true;
  try {
    await accountAction('email', Object.fromEntries(new FormData(form)));
    form.reset();
    $('account-result').textContent = 'Email saved.';
  } catch (error) {
    $('account-result').textContent = error.message || 'Could not save the email.';
  } finally { $('save-email').disabled = false; }
});
$('account-database').addEventListener('click', () => $('account-dialog').close());
$('sign-out').addEventListener('click', async () => {
  $('sign-out').disabled = true;
  try {
    await accountAction('logout');
    $('account-dialog').close();
  } catch (error) {
    $('account-result').textContent = error.message || 'Could not sign out.';
  } finally { $('sign-out').disabled = false; }
});

const tableDates = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium',
});
let databaseRequest = 0;
const databaseDescriptions = {
  accounts: 'Account details and registration dates.',
  headlines: 'Publisher headlines and model labels used in the dashboard.',
  analyses: 'Quick analysis results saved by signed-in accounts.',
  quotes: 'Spot prices recorded when the dashboard refreshes.',
  candles: 'Hourly opening, high, low, and closing prices for viewed coins.',
};
async function loadDatabase() {
  const request = ++databaseRequest;
  const status = $('database-status');
  const table = $('database-results');
  const scroll = $('database-scroll');
  const previous = $('database-prev');
  const next = $('database-next');
  status.textContent = 'Loading records…';
  previous.disabled = next.disabled = true;
  $('reload-database').disabled = true;
  scroll.setAttribute('aria-busy', 'true');
  const tableName = $('database-table').value;
  $('database-description').textContent = databaseDescriptions[tableName];
  const params = new URLSearchParams({ table: tableName, page: localAccount.tablePage });
  try {
    const response = await fetch(localApi + 'database?' + params);
    const { columns, rows, total, page, pageSize, error } = await response.json();
    if (request !== databaseRequest || localAccount.user?.role !== 'admin') return;
    if (!response.ok) throw new Error(error);
    const header = node('thead');
    const labels = node('tr');
    for (const column of columns) {
      const heading = node('th', '', column.replaceAll('_', ' ') + (column.endsWith('_at') ? ' (UTC)' : ''));
      heading.scope = 'col';
      labels.append(heading);
    }
    header.append(labels);
    const content = node('tbody');
    for (const record of rows) {
      const row = node('tr');
      for (const column of columns) {
        const value = record[column];
        const display = value === null ? '—' : column.endsWith('_at') ? tableDates.format(value)
          : column.endsWith('_usd') ? dollars(value)
          : column === 'confidence' ? `${(value * 100).toFixed(1)}%` : String(value);
        const cell = node('td', '', display);
        if (column === 'password_status') cell.className = 'positive';
        row.append(cell);
      }
      content.append(row);
    }
    table.replaceChildren(header, content);
    status.textContent = total ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + rows.length} of ${total} records` : 'No records yet.';
    previous.disabled = page <= 1;
    next.disabled = page * pageSize >= total;
    reveal(table, 3);
  } catch (error) {
    if (request !== databaseRequest || localAccount.user?.role !== 'admin') return;
    table.replaceChildren();
    status.textContent = error.message || 'Could not load records.';
  } finally {
    if (request === databaseRequest) {
      $('reload-database').disabled = false;
      scroll.setAttribute('aria-busy', 'false');
    }
  }
}

$('database-table').addEventListener('change', () => { localAccount.tablePage = 1; loadDatabase(); });
$('reload-database').addEventListener('click', loadDatabase);
$('database-prev').addEventListener('click', () => { localAccount.tablePage--; loadDatabase(); });
$('database-next').addEventListener('click', () => { localAccount.tablePage++; loadDatabase(); });

$('analysis-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('headline').value.trim();
  const output = $('analysis-result');
  if (!text) {
    output.textContent = 'Enter a headline to analyze.';
    return;
  }
  const button = event.submitter;
  const buttons = [...event.currentTarget.querySelectorAll('button[type="submit"]')];
  for (const item of buttons) item.disabled = true;
  $('headline').readOnly = true;
  const useFinbert = button?.value === 'finbert';
  output.textContent = useFinbert ? 'Loading FinBERT · 111 MB on first use' : 'Analyzing…';
  try {
    let result;
    if (useFinbert) result = await classify(text, await getClassifier());
    else {
      const response = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }), signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Analysis unavailable');
      result = (await response.json()).scores;
    }
    output.replaceChildren(node('strong', result[0].label, `${label(result[0].label)} sentiment`),
      node('p', 'model-label', useFinbert ? 'ProsusAI FinBERT' : 'Live headline model'));
    for (const prediction of result) {
      const row = node('div', `confidence-row ${prediction.label}`);
      const name = label(prediction.label);
      const progress = node('progress');
      progress.max = 1;
      progress.value = prediction.score;
      progress.setAttribute('aria-label', `${name} confidence`);
      row.append(node('span', '', name), progress, node('span', '', `${(prediction.score * 100).toFixed(1)}%`));
      output.append(row);
    }
    reveal(output);
  } catch (error) {
    console.error('Headline analysis failed', error);
    output.textContent = useFinbert ? 'FinBERT could not run. Try Quick analysis or retry the download.' : 'Analysis is unavailable. Try again.';
  } finally {
    $('headline').readOnly = false;
    for (const item of buttons) item.disabled = false;
  }
});

$('app-shell').inert = true;
renderQuotes({ animate: false });
showPage();
function finishLoading() {
  $('boot-screen').classList.add('is-ready');
  $('app-shell').inert = false;
}
const bootTimeout = setTimeout(finishLoading, 950);
connectAccount().then(refresh).finally(() => {
  clearTimeout(bootTimeout);
  finishLoading();
});
