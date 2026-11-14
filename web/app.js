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

function reveal(element, offset = 5, duration = 220) {
  entrances.get(element)?.cancel();
  if (reducedMotion.matches || element.closest('[hidden]')) return;
  entrances.set(element, element.animate([
    { opacity: .55, translate: `0 ${offset}px` },
    { opacity: 1, translate: '0 0' },
  ], { duration, easing }));
}

function coinIcon(coin) {
  const icon = node('span', 'coin-icon');
  const image = node('img');
  image.src = `/assets/${coin.symbol.toLowerCase()}.png`;
  image.alt = '';
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
  const { error, result } = await (await fetchSource(kraken + endpoint)).json();
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

async function getIndex() {
  const { data } = await (await fetchSource('https://api.alternative.me/fng/?limit=1')).json();
  const value = Number(data?.[0]?.value);
  const description = data?.[0]?.value_classification;
  if (!Number.isFinite(value) || value < 0 || value > 100 || !description) throw new Error('Invalid index');
  return { value, description };
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
  $('fear-label').textContent = index?.description ?? 'Index unavailable';
  $('fear-label').className = index ? `fear-label ${signalClass(index.value)}` : 'fear-label';
  if (index) $('fear-marker').style.setProperty('--position', `${index.value}%`);
}

function signalClass(score) {
  if (score >= 60) return 'positive';
  if (score <= 40) return 'negative';
  return 'neutral';
}

function windowStories() {
  return state.stories.filter(({ time }) => time >= Date.now() - state.hours * 3_600_000);
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
  const stories = windowStories();
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
    ['index', getIndex, renderFear],
    ['news', getStories, () => renderHeadlineData(true)],
  ];
  await Promise.all(tasks.map(async ([key, fetchData, render]) => {
    try {
      const data = await fetchData();
      state.sources[key] = key === 'news' ? data : true;
      render(data);
    } catch (error) {
      state.sources[key] = false;
      console.error(`Unable to refresh ${key}`, error);
      if (key === 'quotes' && !state.quotes.size) renderQuotes();
      if (key === 'index' && $('fear-marker').hidden) renderFear(null);
      if (key === 'news') renderHeadlineData();
    }
  }));
  const active = Object.values(state.sources).filter(Boolean).length;
  badge.dataset.state = active === 3 ? 'live' : active ? 'partial' : 'offline';
  badge.lastElementChild.textContent = active === 3 ? 'Live sources' : active ? 'Partial feed' : 'Sources offline';
  $('refresh').disabled = false;
}

function drawPrice(candles, coin) {
  const ctx = $('coin-chart').getContext('2d');
  const prices = candles.map((row) => Number(row[4])).filter(Number.isFinite);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const span = high - low || high * .02 || 1;
  const points = prices.map((price, index) => [24 + 850 * index / (prices.length - 1), 267 - ((price - low) / span) * 215]);
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
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
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
  $('coin-chart').setAttribute('aria-label', `${coin.name}, hourly closing prices from ${dollars(prices[0])} to ${dollars(prices.at(-1))}.`);
  $('coin-chart-caption').textContent = `24 hourly closes · Range ${dollars(low)} – ${dollars(high)}`;
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
    drawPrice(candles, coin);
    chart.classList.remove('is-loading');
    reveal(chart, 3);
  } catch {
    if (state.details === request) {
      chart.hidden = true;
      $('coin-chart-caption').textContent = 'Hourly prices are unavailable.';
    }
  }
}

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
};
function showPage() {
  const hash = window.location.hash.slice(1);
  const page = Object.hasOwn(pages, hash) ? hash : 'overview';
  const workspace = $('workspace');
  if (workspace.dataset.page === page) return;
  const switching = Boolean(workspace.dataset.page);
  state.page = page;
  state.visible = 6;
  const [title, subtitle] = pages[state.page];
  $('page-title').textContent = title;
  $('page-subtitle').textContent = subtitle;
  workspace.dataset.page = state.page;
  $('timeframes').hidden = ['coins', 'sources'].includes(state.page);
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
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (switching) {
    reveal($('page-title'), 6, 260);
    reveal(workspace, 8, 260);
  }
}
window.addEventListener('hashchange', showPage);
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

renderQuotes({ animate: false });
showPage();
refresh();
