# MarketMind AI

MarketMind AI tracks cryptocurrency prices from Kraken and English-language headlines from 21 publisher feeds. Alternative.me supplies the separate Crypto Fear & Greed Index.

## Run locally

Requires Node.js 22 or newer. Run these commands from the project folder.

```sh
npm run build
npm run preview
```

Open http://127.0.0.1:4173/. The preview uses the same Worker handler as the hosted Site. It needs internet access for market data and news.

## Headline analysis

The Worker fetches RSS and Atom feeds in parallel, deduplicates headlines and URLs, and caches the combined response for three minutes. It classifies headlines on the server using a logistic regression model trained on the [Twitter Financial News Sentiment dataset](https://huggingface.co/datasets/zeroshot/twitter-financial-news-sentiment) and supplementary crypto examples. Its word and two-word features are exported to `worker/model.json`. The model can be reproduced using `scripts/train-model.py`, scikit-learn, and the dataset's training and validation CSVs.

Quick analysis in the headline dialog uses the same Worker classifier. The **Run FinBERT** button uses the [ONNX port](https://huggingface.co/Xenova/finbert) of [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) in the browser. It downloads about 111 MB of weights the first time and processes the entered text locally. Neither path requires an API key.

The sentiment index averages `50 + 50 × (P(positive) − P(negative))` across the selected period. Asset scores use headlines mentioning the coin by name, ticker, or a common alias. The article count is the sample size. Assets with zero matched headlines display **No coverage**. Kraken price moves are measured from midnight UTC.

Coin marks are sourced from [Cryptocurrency Icons](https://github.com/spothq/cryptocurrency-icons) and [CoinMarketCap](https://coinmarketcap.com/).
