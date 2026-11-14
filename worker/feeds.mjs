export const feeds = {
  'CoinDesk': 'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'Cointelegraph': 'https://cointelegraph.com/rss',
  'Decrypt': 'https://decrypt.co/feed',
  'The Block': 'https://www.theblock.co/rss.xml',
  'Bitcoin Magazine': 'https://bitcoinmagazine.com/feed',
  'Bitcoin.com News': 'https://news.bitcoin.com/feed/',
  'CryptoSlate': 'https://cryptoslate.com/feed/',
  'CryptoNews': 'https://cryptonews.com/news/feed/',
  'DL News': 'https://www.dlnews.com/arc/outboundfeeds/rss/',
  'Protos': 'https://protos.com/feed/',
  'Blockworks': 'https://blockworks.com/feed',
  'Crypto Briefing': 'https://cryptobriefing.com/feed/',
  'NewsBTC': 'https://www.newsbtc.com/feed/',
  'U.Today': 'https://u.today/rss.php',
  'CryptoPotato': 'https://cryptopotato.com/feed/',
  'Unchained': 'https://unchainedcrypto.com/feed/',
  'The Defiant': 'https://thedefiant.io/api/feed',
  'CoinJournal': 'https://coinjournal.net/news/feed/',
  'Crypto Economy': 'https://crypto-economy.com/feed/',
  'The Daily Hodl': 'https://dailyhodl.com/feed/',
  'AMBCrypto': 'https://ambcrypto.com/feed/',
};

const entities = {amp:'&', quot:'"', apos:"'", lt:'<', gt:'>', nbsp:' ', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”', ndash:'–', mdash:'—', hellip:'…'};

function decode(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, value) => {
      if (value[0] !== '#') return entities[value] ?? match;
      const number = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1));
      return number <= 0x10ffff ? String.fromCodePoint(number) : match;
    }).trim();
}

function field(xml, tag) {
  return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'i'))?.[1] ?? '';
}

export function parseFeed(xml, source, now = Date.now()) {
  return [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi)]
    .slice(0, 70)
    .flatMap(([, , entry]) => {
      const title = decode(field(entry, 'title')).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
      const stamp = field(entry, 'pubDate') || field(entry, 'published') || field(entry, 'updated') || field(entry, 'dc:date');
      const time = Date.parse(decode(stamp));
      const atomLinks = [...entry.matchAll(/<link\s+([^>]+)>/gi)].map(([, attributes]) => attributes);
      const atomLink = atomLinks.find((attributes) => /\brel=["']alternate["']/.test(attributes)) ?? atomLinks[0];
      const address = field(entry, 'link') || atomLink?.match(/\bhref=(["'])(.*?)\1/)?.[2] || '';
      if (!title || !address || !Number.isFinite(time) || time > now + 300_000 || time < now - 7 * 86_400_000) return [];
      try {
        const url = new URL(decode(address), feeds[source]);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
        for (const key of [...url.searchParams.keys()]) {
          if (/^utm_|^(ref|output)$/i.test(key)) url.searchParams.delete(key);
        }
        url.hash = '';
        return [{ title: title.slice(0, 350), href: url.href, time, source }];
      } catch { return []; }
    });
}

export function mergeStories(lists) {
  const titles = new Set();
  const links = new Set();
  return lists.flat().sort((a, b) => b.time - a.time).filter(({ title, href }) => {
    const key = title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (titles.has(key) || links.has(href)) return false;
    titles.add(key);
    links.add(href);
    return true;
  }).slice(0, 650);
}
