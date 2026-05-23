const axios = require('axios');

const GOOGLE_FINANCE_EXCHANGE = process.env.GOOGLE_FINANCE_EXCHANGE || 'BVMF';

function parseNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseGoogleMoney(value) {
    if (!value) return 0;
    return parseNumber(
        String(value)
            .replace(/R\$\s?/i, '')
            .replace(/\./g, '')
            .replace(',', '.')
            .replace(/[^\d.-]/g, ''),
    );
}

function normalizeRealtimeQuote(raw) {
    return {
        symbol: String(raw.symbol || raw.ticker || raw.asset || '').toUpperCase(),
        price: parseNumber(raw.price ?? raw.lastTrade ?? raw.last ?? raw.close),
        bid: parseNumber(raw.bid ?? raw.bestBid),
        ask: parseNumber(raw.ask ?? raw.bestAsk),
        volume: parseNumber(raw.volume ?? raw.volumeAmount),
        high: parseNumber(raw.high),
        low: parseNumber(raw.low),
        open: parseNumber(raw.open),
        change: parseNumber(raw.change ?? raw.changePercent ?? raw.change_percent),
        timestamp: raw.timestamp || raw.dateUpdate || raw.updatedAt || new Date().toISOString(),
    };
}

async function fetchGoogleFinanceQuote(symbol) {
    const url = `https://www.google.com/finance/quote/${encodeURIComponent(symbol)}:${encodeURIComponent(GOOGLE_FINANCE_EXCHANGE)}?hl=pt-BR`;
    const response = await axios.get(url, {
        timeout: 12000,
        headers: { 'User-Agent': 'AnaliseDeMercado/1.0' },
    });
    const html = response.data;
    const ds2Match = html.match(/AF_initDataCallback\(\{key: 'ds:2'[\s\S]*?data:\[\[\[\["[^"]+",\["([^"]+)","([^"]+)"\],"([^"]+)",\d+,"([^"]+)",\[([\d.,-]+)/);
    const visiblePriceMatch = html.match(/<span>R\$\s*([\d.,]+)<\/span>/);
    const visibleChangeMatch = html.match(/class="gMvHvf">([+-]?[\d.,]+)%<\/span>/);

    if (ds2Match) {
        return normalizeRealtimeQuote({
            symbol: ds2Match[1],
            price: parseGoogleMoney(ds2Match[5]),
            change: visibleChangeMatch ? parseGoogleMoney(visibleChangeMatch[1]) : 0,
            timestamp: new Date().toISOString(),
        });
    }

    if (visiblePriceMatch) {
        return normalizeRealtimeQuote({
            symbol,
            price: parseGoogleMoney(visiblePriceMatch[1]),
            change: visibleChangeMatch ? parseGoogleMoney(visibleChangeMatch[1]) : 0,
            timestamp: new Date().toISOString(),
        });
    }

    return null;
}

async function fetchGoogleFinanceQuotes(symbols) {
    if (process.env.GOOGLE_FINANCE_ENABLED === 'false') return null;

    const results = await Promise.allSettled(symbols.map((symbol) => fetchGoogleFinanceQuote(symbol)));
    const quotes = results
        .filter((result) => result.status === 'fulfilled' && result.value?.symbol)
        .map((result) => result.value);

    return quotes.length > 0 ? quotes : null;
}

async function fetchConfiguredB3Feed(symbols) {
    if (!process.env.B3_MARKET_DATA_URL) return null;

    const response = await axios.get(process.env.B3_MARKET_DATA_URL, {
        timeout: 12000,
        params: { symbols: symbols.join(',') },
        headers: process.env.B3_MARKET_DATA_KEY
            ? { Authorization: `Bearer ${process.env.B3_MARKET_DATA_KEY}` }
            : undefined,
    });
    const payload = Array.isArray(response.data) ? response.data : response.data?.results || response.data?.quotes || [];

    return payload.map(normalizeRealtimeQuote).filter((item) => item.symbol);
}

function pressureFromQuote(quote) {
    if (quote.bid && quote.ask && quote.price) {
        const midpoint = (quote.bid + quote.ask) / 2;
        return ((quote.price - midpoint) / midpoint) * 100;
    }

    if (quote.high && quote.low && quote.price && quote.high !== quote.low) {
        return ((quote.price - quote.low) / (quote.high - quote.low)) * 100 - 50;
    }

    return quote.change || 0;
}

function signalFromModel({ signal, trend, riskScore, pressure, change }) {
    if (signal === 'Spring' && riskScore < 65 && pressure > -15) return 'Compra tática';
    if (signal === 'Upthrust' || riskScore >= 72 || pressure < -35) return 'Defensivo / venda';
    if (trend === 'Alta' && change > 0 && pressure > 10) return 'Manter comprado';
    if (trend === 'Baixa' && change < 0) return 'Evitar entrada';
    return 'Aguardar confirmação';
}

function modelFallbackFromSignals(signals) {
    return signals.map((item) => {
        const price = parseNumber(item.price);
        const quote = normalizeRealtimeQuote({
            symbol: item.symbol,
            price,
            high: item.resistance,
            low: item.support,
            change: item.change,
            timestamp: new Date().toISOString(),
        });
        const pressure = pressureFromQuote(quote);

        return {
            symbol: item.symbol,
            source: 'BRAPI fallback',
            realtime: false,
            price: item.price,
            pressure: Number(pressure.toFixed(2)),
            modeledSignal: signalFromModel({
                signal: item.signal,
                trend: item.trend,
                riskScore: item.riskScore,
                pressure,
                change: item.change,
            }),
            confidence: item.candles?.length >= 20 ? 'media' : 'baixa',
            riskScore: item.riskScore,
            timestamp: quote.timestamp,
        };
    });
}

function modelRealtimeQuotes(quotes, fallbackSignals) {
    const fallbackBySymbol = new Map(fallbackSignals.map((item) => [item.symbol, item]));

    return quotes.map((quote) => {
        const fallback = fallbackBySymbol.get(quote.symbol) || {};
        const pressure = pressureFromQuote(quote);
        const riskScore = Math.max(
            0,
            Math.min(100, Math.round((fallback.riskScore || 45) + (Math.abs(pressure) > 25 ? 10 : 0))),
        );

        return {
            symbol: quote.symbol,
            source: process.env.B3_MARKET_DATA_PROVIDER || 'B3 Market Data adapter',
            realtime: true,
            price: quote.price.toFixed(2),
            pressure: Number(pressure.toFixed(2)),
            modeledSignal: signalFromModel({
                signal: fallback.signal,
                trend: fallback.trend,
                riskScore,
                pressure,
                change: quote.change,
            }),
            confidence: quote.bid && quote.ask ? 'alta' : 'media',
            riskScore,
            timestamp: quote.timestamp,
        };
    });
}

async function analyzeB3Realtime(symbols, fallbackSignals) {
    const configuredQuotes = await fetchConfiguredB3Feed(symbols);
    const googleQuotes = configuredQuotes ? null : await fetchGoogleFinanceQuotes(symbols);
    const quoteSource = configuredQuotes || googleQuotes;
    const items = quoteSource ? modelRealtimeQuotes(quoteSource, fallbackSignals) : modelFallbackFromSignals(fallbackSignals);

    return {
        agent: 'Agente B3 Tempo Real',
        objective: 'Extrair, normalizar e modelar dados B3 para sinais mais assertivos.',
        updatedAt: new Date().toISOString(),
        realtimeConfigured: Boolean(process.env.B3_MARKET_DATA_URL),
        googleFinanceEnabled: process.env.GOOGLE_FINANCE_ENABLED !== 'false',
        note: process.env.B3_MARKET_DATA_URL
            ? 'Usando conector configurado por B3_MARKET_DATA_URL.'
            : googleQuotes
              ? 'Usando Google Finance como fonte publica de cotacao e BRAPI para candles/modelagem. Para uso profissional, conecte um vendor B3 autorizado.'
              : 'Conector B3 real-time ainda nao configurado; usando BRAPI como fallback ate conectar um vendor/sub-vendor autorizado.',
        items,
    };
}

module.exports = { analyzeB3Realtime };
