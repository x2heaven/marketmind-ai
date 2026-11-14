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
];
const kraken = 'https://api.kraken.com/0/public/';
const storageKey = 'marketmind-finbert-v1';
const $ = (id) => document.getElementById(id);
const state = {
  quotes: new Map(),
  stories: [],
  sentiments: readSentiments(),
  hours: 24,
  visible: 4,
  model: 'loading',
  sources: {},
  details: null,
};
let classifierPromise;
let inferenceQueue = Promise.resolve();
let modelProgress = '';
const transformersUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';

function readSentiments() {
  try { return new Map(JSON.parse(localStorage.getItem(storageKey) ?? '[]')); }
  catch { return new Map(); }
}

function saveSentiments() {
  try { localStorage.setItem(storageKey, JSON.stringify([...state.sentiments].slice(-120))); }
  catch { /* Storage can be unavailable in private or restricted sessions. */ }
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function coinIcon(coin) {
  const icon = node('span', 'coin-icon', coin.icon);
  icon.style.setProperty('--coin', coin.color);
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
  const response = await fetchSource('https://news.bitcoin.com/feed/');
  const xml = new DOMParser().parseFromString(await response.text(), 'text/xml');
  const stories = new Map();
  for (const item of xml.querySelectorAll('item')) {
    const title = item.querySelector('title')?.textContent.trim();
    const href = item.querySelector('link')?.textContent.trim();
    const time = Date.parse(item.querySelector('pubDate')?.textContent);
    if (!title || !href?.startsWith('https://') || !Number.isFinite(time)) continue;
    const assets = coins.filter(({ symbol, name }) => {
      const fullName = new RegExp(`\\b${name}\\b`, 'i').test(title);
      return (symbol !== name && fullName) || new RegExp(`\\b${symbol}\\b`).test(title);
    });
    stories.set(title, { title, href, time, assets });
  }
  if (!stories.size) throw new Error('No valid headlines in news feed');
  return [...stories.values()].sort((a, b) => b.time - a.time);
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
            if (modelProgress === message) return;
            modelProgress = message;
            if (state.model === 'loading') renderSentiment();
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

function renderQuotes() {
  const positions = [
    [48, 49, 39], [17, 22, 27], [77, 76, 30], [79, 23, 23],
    [35, 86, 24], [11, 57, 19], [78, 49, 16], [47, 15, 13],
    [92, 10, 13], [16, 78, 12], [91, 38, 11], [57, 85, 12],
  ];
  const movers = [...state.quotes.values()]
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, positions.length);
  $('bubbles').replaceChildren(...movers.map((quote, index) => {
    const [x, y, size] = positions[index];
    const button = node('button', `bubble${quote.change < 0 ? ' loss' : ''}`);
    button.type = 'button';
    button.style.setProperty('--x', `${x}%`);
    button.style.setProperty('--y', `${y}%`);
    button.style.setProperty('--size', `${size}%`);
    button.setAttribute('aria-label', `${quote.coin.name}, ${quote.change.toFixed(2)} percent, view details`);
    button.append(coinIcon(quote.coin), node('span', 'symbol', quote.coin.symbol), change(quote.change));
    button.addEventListener('click', () => showCoin(quote.coin));
    return button;
  }));
  if (!movers.length) $('bubbles').append(node('p', 'empty', state.sources.quotes === false ? 'Kraken prices are unavailable.' : 'Loading prices…'));
}

function renderFear(index) {
  $('fear-marker').hidden = !index;
  $('fear-value').textContent = index?.value ?? '—';
  $('fear-label').textContent = index?.description ?? 'Index unavailable';
  $('fear-label').className = index ? signalClass(index.value) : '';
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
  const scores = stories.map(({ title }) => state.sentiments.get(title)).filter(Boolean);
  if (!scores.length) return { count: 0, value: null };
  const total = scores.reduce((sum, prediction) => {
    const positive = prediction.find(({ label }) => label === 'positive').score;
    const negative = prediction.find(({ label }) => label === 'negative').score;
    return sum + (1 + positive - negative) / 2;
  }, 0);
  return { count: scores.length, value: Math.round(100 * total / scores.length) };
}

function drawGauge(value) {
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
    ctx.strokeStyle = i < Math.round((value ?? 0) * .37) ? gradient : '#55516d';
    ctx.beginPath();
    ctx.moveTo(280 + 194 * x, 247 + 194 * y);
    ctx.lineTo(280 + 223 * x, 247 + 223 * y);
    ctx.stroke();
  }
}

function renderSentiment() {
  const stories = windowStories();
  const { count, value } = sentimentScore(stories);
  const tone = value === null ? '' : signalClass(value);
  drawGauge(value);
  $('sentiment-value').textContent = value === null ? '—' : `${value}%`;
  $('sentiment-label').textContent = tone ? label(tone) : state.model === 'loading' ? 'Analyzing' : 'No score';
  $('sentiment-label').className = tone;
  let message = `${count} of ${stories.length} headlines analyzed · 50% is neutral`;
  if (!stories.length) message = state.sources.news === false ? 'News feed unavailable' : 'No headlines in this period';
  else if (state.model === 'error') message = count ? `${count} cached results · Model unavailable` : 'Model unavailable · Try refreshing';
  else if (state.model === 'loading') message = count ? `${count} of ${stories.length} headlines analyzed` : modelProgress || 'Loading FinBERT · 111 MB on first use';
  $('sentiment-caption').textContent = message;

  const assets = coins.map((coin) => ({ coin, ...sentimentScore(stories.filter((story) => story.assets.includes(coin))) }))
    .filter((asset) => asset.count)
    .sort((a, b) => b.count - a.count || Math.abs(b.value - 50) - Math.abs(a.value - 50))
    .slice(0, 5);
  $('asset-list').replaceChildren(...assets.map(({ coin, count: mentions, value: score }) => {
    const row = node('button', 'asset-row');
    row.type = 'button';
    const signal = node('span', `asset-signal ${signalClass(score)}`, `${score}% · ${mentions}`);
    signal.title = `${mentions} analyzed headline${mentions === 1 ? '' : 's'}`;
    row.append(coinIcon(coin), node('span', '', coin.name), signal);
    row.addEventListener('click', () => showCoin(coin));
    return row;
  }));
  if (!assets.length) $('asset-list').append(node('p', 'empty',
    state.model === 'loading' ? 'Analyzing headlines…' : 'No scored asset mentions in this period.'));
}

function storyCard(story) {
  const result = state.sentiments.get(story.title)?.[0];
  const card = node('article', 'story');
  const header = node('header');
  header.append(node('span', '', 'Bitcoin.com News'));
  const tagText = result ? label(result.label) : state.model === 'error' ? 'Unscored' : 'Pending';
  const tag = node('span', `tag ${result?.label ?? ''}`, tagText);
  if (result) tag.title = `FinBERT confidence: ${Math.round(result.score * 100)}%`;
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

function renderNews() {
  const filter = $('news-filter').value;
  const stories = windowStories().filter(({ title }) => filter === 'all' || state.sentiments.get(title)?.[0].label === filter);
  $('news-caption').textContent = `Latest ${state.hours === 24 ? '24 hours' : '7 days'} · FinBERT classification`;
  $('news-grid').replaceChildren(...stories.slice(0, state.visible).map(storyCard));
  $('more-news').hidden = stories.length <= state.visible;
  if (!stories.length) {
    let message = 'No matching headlines in this period.';
    if (state.sources.news === false) message = 'News feed is unavailable. Try refreshing.';
    else if (state.sources.news === undefined) message = 'Loading headlines…';
    $('news-grid').append(node('p', 'empty', message));
  }
}

function renderHeadlineData() {
  renderSentiment();
  renderNews();
  if (state.details) renderCoinNews(state.details.coin);
}

async function analyzeStories() {
  const pending = state.stories.filter(({ title }) => !state.sentiments.has(title));
  if (!pending.length) {
    state.model = 'ready';
    renderHeadlineData();
    return;
  }
  state.model = 'loading';
  renderHeadlineData();
  try {
    const classifier = await getClassifier();
    for (const { title } of pending) {
      state.sentiments.set(title, await classify(title, classifier));
      renderHeadlineData();
    }
    state.model = 'ready';
  } catch (error) {
    state.model = 'error';
    console.error('FinBERT could not analyze headlines', error);
  }
  saveSentiments();
  renderHeadlineData();
}

async function refresh() {
  $('refresh').disabled = true;
  const badge = $('live-status');
  badge.dataset.state = '';
  badge.lastElementChild.textContent = 'Connecting';
  const tasks = [
    ['quotes', getQuotes, (quotes) => { state.quotes = quotes; renderQuotes(); }],
    ['index', getIndex, renderFear],
    ['news', getStories, (stories) => { state.stories = stories; renderHeadlineData(); }],
  ];
  await Promise.all(tasks.map(async ([key, fetchData, render]) => {
    try {
      const data = await fetchData();
      state.sources[key] = true;
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
  if (state.stories.length) await analyzeStories();
  else {
    state.model = 'ready';
    renderHeadlineData();
  }
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
  $('coin-news').replaceChildren(...stories.slice(0, 4).map(storyCard));
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
  $('coin-chart').hidden = true;
  $('coin-chart-caption').textContent = 'Loading hourly prices…';
  renderCoinNews(coin);
  if (!dialog.open) dialog.showModal();
  try {
    const result = await fetchKraken(`OHLC?pair=${coin.pair}&interval=60`);
    if (state.details !== request) return;
    const candles = Object.entries(result).find(([key]) => key !== 'last')?.[1].slice(-25, -1);
    if (!candles || candles.length < 2) throw new Error('No price history');
    drawPrice(candles, coin);
    $('coin-chart').hidden = false;
  } catch {
    if (state.details === request) $('coin-chart-caption').textContent = 'Hourly prices are unavailable.';
  }
}

$('refresh').addEventListener('click', refresh);
$('timeframes').addEventListener('click', (event) => {
  const selected = event.target.closest('[data-hours]');
  if (!selected) return;
  state.hours = Number(selected.dataset.hours);
  state.visible = 4;
  for (const button of $('timeframes').querySelectorAll('button')) button.setAttribute('aria-pressed', button === selected);
  renderHeadlineData();
});
$('news-filter').addEventListener('change', () => { state.visible = 4; renderNews(); });
$('more-news').addEventListener('click', () => { state.visible += 4; renderNews(); });
document.querySelectorAll('.topbar nav a').forEach((item) => item.addEventListener('click', () => {
  document.querySelector('.topbar nav .is-active').classList.remove('is-active');
  item.classList.add('is-active');
}));
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
  button.disabled = true;
  $('headline').readOnly = true;
  output.textContent = 'Running FinBERT…';
  try {
    const result = await classify(text, await getClassifier());
    output.replaceChildren(node('strong', result[0].label, `${label(result[0].label)} sentiment`));
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
  } catch (error) {
    console.error('Headline analysis failed', error);
    output.textContent = 'FinBERT could not run. Check your connection and try again.';
  } finally {
    $('headline').readOnly = false;
    button.disabled = false;
  }
});

renderQuotes();
drawGauge(null);
refresh();
