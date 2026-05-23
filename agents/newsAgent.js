const axios = require('axios');

const DEFAULT_FEEDS = [
    {
        scope: 'Brasil',
        url: 'https://news.google.com/rss/search?q=mercado%20financeiro%20Brasil%20B3&hl=pt-BR&gl=BR&ceid=BR:pt-419',
    },
    {
        scope: 'Internacional',
        url: 'https://news.google.com/rss/search?q=global%20markets%20stocks%20economy&hl=en-US&gl=US&ceid=US:en',
    },
];

const POSITIVE_TERMS = [
    'alta',
    'avanca',
    'sobe',
    'ganha',
    'recupera',
    'otimismo',
    'recorde',
    'rally',
    'surge',
    'up',
    'gains',
    'rise',
    'rises',
    'higher',
    'optimism',
];

const NEGATIVE_TERMS = [
    'queda',
    'cai',
    'recua',
    'perde',
    'risco',
    'crise',
    'pressao',
    'volatilidade',
    'down',
    'falls',
    'loss',
    'risk',
    'crisis',
    'selloff',
    'inflation',
];

function decodeXml(value = '') {
    return value
        .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, '')
        .trim();
}

function extractTag(xml, tag) {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? decodeXml(match[1]) : '';
}

function parseRss(xml, scope) {
    const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

    return items.slice(0, 12).map((item) => {
        const title = extractTag(item, 'title');
        const description = extractTag(item, 'description');
        const publishedAt = extractTag(item, 'pubDate');
        const source = extractTag(item, 'source');
        const link = extractTag(item, 'link');
        const text = `${title} ${description}`.toLowerCase();
        const positive = POSITIVE_TERMS.filter((term) => text.includes(term)).length;
        const negative = NEGATIVE_TERMS.filter((term) => text.includes(term)).length;
        const score = positive - negative;

        return {
            scope,
            title,
            description,
            source: source || 'News feed',
            link,
            publishedAt,
            sentiment: score > 0 ? 'positivo' : score < 0 ? 'negativo' : 'neutro',
            score,
            impact: Math.min(100, Math.abs(score) * 25 + (title.length > 80 ? 10 : 0)),
        };
    });
}

function getFeeds() {
    if (!process.env.NEWS_FEEDS) return DEFAULT_FEEDS;

    return process.env.NEWS_FEEDS.split(',')
        .map((entry) => {
            const [scope, ...urlParts] = entry.trim().split('|');
            const url = urlParts.join('|') || scope;
            return {
                scope: urlParts.length > 0 ? scope : 'Custom',
                url,
            };
        })
        .filter((feed) => feed.url);
}

function summarize(items) {
    const score = items.reduce((sum, item) => sum + item.score, 0);
    const national = items.filter((item) => item.scope.toLowerCase().includes('brasil')).length;
    const international = items.length - national;
    const highImpact = items.filter((item) => item.impact >= 50).length;

    return {
        bias: score > 1 ? 'positivo' : score < -1 ? 'negativo' : 'neutro',
        score,
        national,
        international,
        highImpact,
        confidence: items.length >= 8 ? 'alta' : items.length >= 4 ? 'media' : 'baixa',
    };
}

async function analyzeMarketNews() {
    const feeds = getFeeds();
    const responses = await Promise.allSettled(
        feeds.map(async (feed) => {
            const response = await axios.get(feed.url, {
                timeout: 15000,
                headers: { 'User-Agent': 'AnaliseDeMercado/1.0' },
            });

            return parseRss(response.data, feed.scope);
        }),
    );
    const items = responses.flatMap((response) => (response.status === 'fulfilled' ? response.value : []));
    const sorted = items
        .filter((item) => item.title)
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
        .slice(0, 16);

    return {
        agent: 'Agente de Noticias Macro',
        objective: 'Analisar noticias nacionais e internacionais que podem afetar B3, juros, cambio e apetite a risco.',
        updatedAt: new Date().toISOString(),
        sources: feeds.map((feed) => feed.scope),
        summary: summarize(sorted),
        items: sorted,
    };
}

module.exports = { analyzeMarketNews };
