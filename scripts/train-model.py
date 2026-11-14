"""Train the lightweight classifier from the Twitter Financial News Sentiment CSVs."""
import csv
import json
import re
import sys
from pathlib import Path

from sklearn.feature_extraction.text import CountVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score


def features(text):
    text = re.sub(r"https?://\S+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\$[A-Z0-9]{1,10}\b", "", text)
    words = re.findall(r"[a-z]{2,}", text.lower())
    return set(words + [a + " " + b for a, b in zip(words, words[1:])])


def load(path):
    with open(path, newline="", encoding="utf-8") as handle:
        return [(row["text"], int(row["label"])) for row in csv.DictReader(handle)]


train, validation = map(load, sys.argv[1:3])
crypto_examples = {
    0: [
        "Bitcoin tumbles as leveraged crypto liquidations surge",
        "Ether drops after ETF outflows accelerate",
        "Exchange suffers major hack and suspends withdrawals",
        "Solana slides amid network outage and heavy selling",
        "Crypto lender files for bankruptcy after liquidity crisis",
        "Traders dump altcoins as Bitcoin breaks below support",
        "Aave falls after attackers exploit protocol and drain funds",
        "XRP extends losses as investor demand weakens",
    ],
    1: [
        "Bitcoin soars as ETF inflows hit a record high",
        "Ether rallies after institutional demand strengthens",
        "Solana jumps on strong network growth and rising activity",
        "Altcoins surge as market recovers from losses",
        "Bitcoin breaks above resistance as buying pressure builds",
        "Chainlink climbs after deal expands adoption",
        "XRP gains as bullish momentum picks up",
        "Crypto fund reports record inflows as confidence returns",
    ],
    2: [
        "Bitcoin ETF issuers publish weekly fund flows report",
        "Ethereum developers set date for upcoming network upgrade",
        "Crypto market awaits US inflation figures",
        "Kraken adds new trading pair to its exchange",
        "Regulator releases consultation on crypto market rules",
        "New report examines institutional participation in Bitcoin",
        "Solana foundation announces developer conference dates",
        "Research paper compares several approaches to crypto custody",
    ],
}
train += [(text, label) for label, texts in crypto_examples.items() for text in texts] * 8
train_text, train_label = zip(*train)
test_text, test_label = zip(*validation)
vectorizer = CountVectorizer(analyzer=features, binary=True, min_df=2, max_features=12_000)
classifier = LogisticRegression(C=1.6, max_iter=350, class_weight="balanced")
classifier.fit(vectorizer.fit_transform(train_text), train_label)
predictions = classifier.predict(vectorizer.transform(test_text))
print(f"Validation n={len(test_label)} accuracy={accuracy_score(test_label, predictions):.3f} macro F1={f1_score(test_label, predictions, average='macro'):.3f}")
names = ["negative", "positive", "neutral"]
model = {
    "labels": [names[i] for i in classifier.classes_],
    "bias": classifier.intercept_.round(3).tolist(),
    "weights": dict(zip(vectorizer.get_feature_names_out(), classifier.coef_.T.round(3).tolist())),
}
output = Path(__file__).resolve().parent.parent / "worker/model.json"
output.write_text(json.dumps(model, separators=(",", ":")) + "\n", encoding="utf-8")
