# MarketMind AI

MarketMind AI is a static dashboard for the Veritas AI Hackathon. It displays crypto prices from Kraken, the Crypto Fear & Greed Index from Alternative.me, and English-language headlines from Bitcoin.com News.

## Run locally

Serve the `dist` directory over HTTP. For example, with Python installed, run this command from the project folder:

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:4173/. The dashboard requires internet access to fetch data and download the model. No API key is required.

## How FinBERT is connected

The application loads [Transformers.js](https://huggingface.co/docs/transformers.js/) and runs the [ONNX port](https://huggingface.co/Xenova/finbert) of [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) locally using WebAssembly. The browser downloads about 111 MB of quantized weights on first use and caches the model when storage is available. The headline typed into the analysis form is processed in the browser.

```js
import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
const classify = await pipeline('text-classification', 'Xenova/finbert', {
  device: 'wasm',
  dtype: 'q8',
});
const scores = await classify('Bitcoin rises after strong ETF inflows', { top_k: 3 });
```

FinBERT returns probabilities for positive, neutral, and negative sentiment. The dashboard calculates a sentiment index by averaging `100 × (1 + P(positive) − P(negative)) / 2` across analyzed headlines. Fifty represents neutral sentiment. Per-asset scores use the subset of headlines that mention the asset by name or ticker. The time filters apply to headlines available in the RSS feed. Today’s price changes are measured from midnight UTC.
