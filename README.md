# MarketMind AI

MarketMind AI tracks cryptocurrency prices from Kraken and analyzes English-language headlines from 21 publisher feeds.

## Run locally

On Windows, extract the entire archive and double-click `Requirements.bat` to check your setup. See [Requirements](REQUIREMENTS.md) for what is needed. Then double-click `Start-MarketMind.bat` to build and open the site. Keep the command window open while using the site. To stop the server, close the window or press Ctrl+C.

To start it manually from the project folder, run:

```sh
npm run build
npm run preview
```

Open http://127.0.0.1:4173/. The preview uses the same Worker handler as the hosted Site. It needs internet access for market data and news.

## Local accounts and database

The local server creates `data/marketmind.sqlite` on first start. To create the database administrator, copy the one-time setup code shown in the server window. On the website, open **Account → Set up admin**, enter a username and password, and paste the code. Once signed in, open **Database** to browse accounts, headlines, price snapshots, hourly candles, and signed-in Quick analysis results. You can create regular accounts through **Account → Create account**.

New members and administrators provide an email and confirm their password. Existing users can add their email from **Account** after signing in. The Accounts table shows the email and password status. Password hashes and salts are stored locally and omitted from the admin response.

Headlines and quotes are collected when the dashboard fetches them. Hourly candles are collected when you open a coin. The local accounts, session data, and records stay with this SQLite file. The hosted dashboard uses Sites access controls. The `data/` folder is excluded from Git.

Use **Watch** in a coin dialog to save that coin to **Watchlist**. Signed-in local users get a separate SQLite watchlist per account. The hosted dashboard and local guests save their watchlist in the current browser.

## Headline analysis

The Worker fetches RSS and Atom feeds in parallel, deduplicates headlines and URLs, and caches the combined response for three minutes. It classifies headlines on the server using a logistic regression model trained on the [Twitter Financial News Sentiment dataset](https://huggingface.co/datasets/zeroshot/twitter-financial-news-sentiment) and supplementary crypto examples. Its word and two-word features are exported to `worker/model.json`. The model can be reproduced using `scripts/train-model.py`, scikit-learn, and the dataset's training and validation CSVs.

Quick analysis in the headline dialog uses the same Worker classifier. The **Run FinBERT** button uses the [ONNX port](https://huggingface.co/Xenova/finbert) of [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) in the browser. It downloads about 111 MB of weights the first time and processes the entered text locally. Neither path requires an API key.

The sentiment index averages `50 + 50 × (P(positive) − P(negative))` across the selected period. Asset scores use headlines mentioning the coin by name, ticker, or a common alias. The article count is the sample size. Assets with zero matched headlines display **No coverage**. Kraken price moves are measured from midnight UTC.

AI News Pulse uses the balance of positive and negative model labels across all headlines. AI Market Brief links to the highest-confidence positive and negative articles. Asset Sentiment Shifts compares model scores from the two halves of the selected period when both halves have at least three mentions of a coin.

Coin details show which headlines support the score, with a price chart and hourly sentiment sharing the same time axis. Numbered markers link to high-confidence positive and negative headlines at their publication times. Empty sentiment intervals mean there were no matching headlines. The headline analyzer also flags possible market relevance using text rules. Relevance, sentiment, and the observed price chart do not establish causation or predict a trade outcome.

## Validation

The deployed headline model and an always-neutral baseline were evaluated on the same 2,388 examples from the dataset's validation split. Neutral was the majority label in the training split.

| Method | Accuracy | Macro F1 |
| --- | ---: | ---: |
| Always neutral | 65.6% | 0.264 |
| MarketMind headline model | 82.0% | 0.757 |

These results measure headline tone on the financial-news dataset. An independent, manually labeled sample of current crypto headlines would test how well it transfers to the live feed. Some negative examples were classified as neutral.

This project is a prototype and is not financial advice.

Coin marks are sourced from [Cryptocurrency Icons](https://github.com/spothq/cryptocurrency-icons) and [CoinMarketCap](https://coinmarketcap.com/).
