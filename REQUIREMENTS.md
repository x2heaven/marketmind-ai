# MarketMind AI requirements

## Run locally on Windows

- [Node.js](https://nodejs.org/en/download) **22.13 or newer** on PATH. Node includes the SQLite engine used by the site. No separate database server or npm package installation is required.
- A current browser with JavaScript enabled.
- Write access to the extracted project folder. The launcher builds into `dist/` and saves the local database in `data/`.
- A free local port. The default is **4173**. The optional `MARKETMIND_PORT` environment variable overrides it.
- Internet access for Kraken prices and publisher feeds. **Quick analysis** uses the bundled model. **Run FinBERT** uses WebAssembly and downloads roughly 111 MB of model weights on first use. Neither mode requires an API key.

Extract the entire ZIP, double-click **`Requirements.bat`**, then launch **`Start-MarketMind.bat`**. The check reports missing files and software, port conflicts, and network availability. A network warning can affect online features even when the local server starts.

## Retrain the included model (optional)

Use Python 3.11 or newer and the dataset's training and validation CSVs linked in the README. From the project folder:

```powershell
python -m pip install -r requirements.txt
python scripts/train-model.py path/to/train.csv path/to/valid.csv
```

Training replaces `worker/model.json`. Restart the site to use the exported model.
