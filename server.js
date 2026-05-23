const path = require('node:path');
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { analyzeMarketNews } = require('./agents/newsAgent');
const { analyzeB3Realtime } = require('./agents/b3RealtimeAgent');
const { DEFAULT_B3_ASSETS } = require('./data/b3Assets');

const app = express();
const port = process.env.PORT || 3000;
const API_KEY = process.env.BRAPI_TOKEN || '';
const symbols = (process.env.SYMBOLS || 'PETR4,VALE3,ITUB4')
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
const defaultBatchSize = Number.parseInt(process.env.MONITOR_BATCH_SIZE || '12', 10);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => {
    res.json({ ok: true, symbols });
});

function getQuoteResult(payload) {
    if (Array.isArray(payload?.results) && payload.results.length > 0) {
        return payload.results[0];
    }

    return payload || {};
}

function getHistoricalCandles(payload) {
    if (Array.isArray(payload?.results) && payload.results.length > 0) {
        const result = payload.results[0] || {};
        return result.historicalDataPrice || result.candles || [];
    }

    return payload?.historicalDataPrice || payload?.candles || [];
}

function normalizeTicker(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

function uniqueSymbols(values) {
    return [...new Set(values.map(normalizeTicker).filter(Boolean))];
}

function normalizeAssetList(payload) {
    const rows = Array.isArray(payload)
        ? payload
        : payload?.results || payload?.tickers || payload?.data || payload?.items || payload?.assets || [];

    if (!Array.isArray(rows)) return [];

    return uniqueSymbols(
        rows.map((item) => {
            if (typeof item === 'string') return item;
            return item?.ticker || item?.symbol || item?.codigo || item?.code || item?.codneg || item?.asset || '';
        }),
    );
}

async function getB3Universe() {
    const envSymbols = uniqueSymbols(String(process.env.B3_ALL_SYMBOLS || '').split(','));
    if (envSymbols.length > 0) {
        return { source: 'env', symbols: envSymbols };
    }

    const remoteUrl = process.env.B3_ASSETS_URL || process.env.DADOS_MERCADO_TICKERS_URL;
    const remoteToken = process.env.B3_ASSETS_TOKEN || process.env.DADOS_MERCADO_TOKEN;
    const defaultDadosMercadoUrl = remoteToken ? 'https://api.dadosdemercado.com.br/v1/tickers' : '';
    const universeUrl = remoteUrl || defaultDadosMercadoUrl;

    if (universeUrl) {
        try {
            const headers = remoteToken ? { Authorization: `Bearer ${remoteToken}` } : {};
            const response = await axios.get(universeUrl, { headers, timeout: 30000 });
            const remoteSymbols = normalizeAssetList(response.data);

            if (remoteSymbols.length > 0) {
                return { source: 'remote', symbols: remoteSymbols };
            }
        } catch (error) {
            console.warn(`B3 universe fallback enabled: ${error.message}`);
        }
    }

    return { source: 'fallback', symbols: DEFAULT_B3_ASSETS };
}

function paginateSymbols(symbolList, req) {
    const limitInput = Number.parseInt(req.query.limit || defaultBatchSize, 10);
    const offsetInput = Number.parseInt(req.query.offset || '0', 10);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitInput) ? limitInput : defaultBatchSize));
    const offset = Math.max(0, Number.isFinite(offsetInput) ? offsetInput : 0);
    const page = symbolList.slice(offset, offset + limit);

    return {
        limit,
        offset,
        nextOffset: offset + page.length < symbolList.length ? offset + page.length : null,
        page,
    };
}

function parseNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function average(values) {
    const clean = values.filter((value) => Number.isFinite(value));
    if (clean.length === 0) return 0;
    return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function standardDeviation(values) {
    const avg = average(values);
    const variance = average(values.map((value) => (value - avg) ** 2));
    return Math.sqrt(variance);
}

function calculateRsi(closes, period = 14) {
    if (closes.length <= period) return null;

    const slice = closes.slice(-(period + 1));
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < slice.length; i += 1) {
        const diff = slice[i] - slice[i - 1];
        if (diff >= 0) gains += diff;
        else losses += Math.abs(diff);
    }

    if (losses === 0) return 100;

    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
}

function classifyTrend(closes) {
    if (closes.length < 10) return 'Neutro';

    const shortAvg = average(closes.slice(-5));
    const longAvg = average(closes.slice(-20));
    const diff = ((shortAvg - longAvg) / longAvg) * 100;

    if (diff > 0.6) return 'Alta';
    if (diff < -0.6) return 'Baixa';
    return 'Lateral';
}

function calculateRiskScore({ signal, change, volatility, rsi }) {
    let score = 45;

    if (signal === 'Spring') score -= 12;
    if (signal === 'Upthrust') score += 18;
    if (Math.abs(change) > 2) score += 10;
    if (volatility > 2) score += 12;
    if (rsi !== null && (rsi > 70 || rsi < 30)) score += 10;

    return Math.max(0, Math.min(100, Math.round(score)));
}

function formatCandle(candle) {
    const close = parseNumber(candle.close);
    return {
        date: candle.date || candle.datetime || candle.timestamp || candle.time || '',
        open: parseNumber(candle.open, close),
        high: parseNumber(candle.high, close),
        low: parseNumber(candle.low, close),
        close,
        volume: parseNumber(candle.volume),
    };
}

async function buildSignal(symbol) {
    const intradayUrl = `https://brapi.dev/api/historical-data?symbol=${encodeURIComponent(symbol)}&interval=5min&range=2D&token=${encodeURIComponent(API_KEY)}`;
    const dailyUrl = `https://brapi.dev/api/historical-data?symbol=${encodeURIComponent(symbol)}&interval=1d&range=1mo&token=${encodeURIComponent(API_KEY)}`;
    const [intradayRes, dailyRes] = await Promise.allSettled([
        axios.get(intradayUrl, { timeout: 20000 }),
        axios.get(dailyUrl, { timeout: 20000 }),
    ]);

    if (intradayRes.status === 'rejected') {
        throw intradayRes.reason;
    }

    const candles = getHistoricalCandles(intradayRes.value.data).map(formatCandle);
    const dailyCandles = dailyRes.status === 'fulfilled'
        ? getHistoricalCandles(dailyRes.value.data).map(formatCandle).slice(-30)
        : [];

    if (candles.length < 20) {
        return {
            symbol,
            signal: 'None',
            price: 'N/A',
            change: 0,
            trend: 'Sem dados',
            riskScore: 0,
            rsi: null,
            volatility: 0,
            support: null,
            resistance: null,
            volumeAvg: 0,
            candles: [],
            dailyCandles,
        };
    }

    const recent = candles.slice(-20);
    const lows = recent.map((c) => c.low);
    const highs = recent.map((c) => c.high);
    const closes = recent.map((c) => c.close);
    const prevMinLow = Math.min(...lows.slice(0, -1));
    const prevMaxHigh = Math.max(...highs.slice(0, -1));
    const last = recent[recent.length - 1];

    let signal = 'None';

    if (last.low < prevMinLow && last.close > prevMinLow) {
        signal = 'Spring';
    } else if (last.high > prevMaxHigh && last.close < prevMaxHigh) {
        signal = 'Upthrust';
    }

    const quoteUrl = `https://brapi.dev/api/quote/${encodeURIComponent(symbol)}?token=${encodeURIComponent(API_KEY)}`;
    const quoteRes = await axios.get(quoteUrl, { timeout: 20000 });
    const quote = getQuoteResult(quoteRes.data);
    const rawPrice = quote.regularMarketPrice ?? quote.price ?? last.close;
    const rawChange = quote.regularMarketChangePercent ?? quote.change_percent ?? quote.changes ?? 0;
    const priceValue = parseNumber(rawPrice, last.close);
    const change = parseNumber(rawChange);
    const returns = closes.slice(1).map((close, index) => ((close - closes[index]) / closes[index]) * 100);
    const volatility = standardDeviation(returns);
    const rsi = calculateRsi(closes);

    return {
        symbol,
        signal,
        price: priceValue.toFixed(2),
        change,
        trend: classifyTrend(closes),
        riskScore: calculateRiskScore({ signal, change, volatility, rsi }),
        rsi: rsi === null ? null : Number(rsi.toFixed(2)),
        volatility: Number(volatility.toFixed(2)),
        support: Number(prevMinLow.toFixed(2)),
        resistance: Number(prevMaxHigh.toFixed(2)),
        volumeAvg: Math.round(average(recent.map((c) => c.volume))),
        candles: candles.slice(-40),
        dailyCandles: dailyCandles.length > 0 ? dailyCandles : candles.slice(-30),
    };
}

app.get('/api/signals', async (req, res) => {
    try {
        if (!API_KEY) {
            return res.status(500).json({
                error: 'BRAPI_TOKEN is not configured. Set it as an environment variable.',
            });
        }

        const allAssets = String(req.query.all || '').toLowerCase() === 'true';
        let selectedSymbols;
        let meta = null;

        if (allAssets) {
            const universe = await getB3Universe();
            const page = paginateSymbols(universe.symbols, req);
            selectedSymbols = page.page;
            meta = {
                mode: 'all-b3',
                source: universe.source,
                total: universe.symbols.length,
                limit: page.limit,
                offset: page.offset,
                nextOffset: page.nextOffset,
            };
        } else {
            const requestedSymbols = uniqueSymbols(String(req.query.symbols || '').split(','));
            selectedSymbols = requestedSymbols.length > 0 ? requestedSymbols : symbols;
        }

        const signals = await Promise.all(selectedSymbols.map((symbol) => buildSignal(symbol)));

        res.json(meta ? { meta, signals } : signals);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: `API error: ${err.message}` });
    }
});

app.get('/api/assets', async (req, res) => {
    try {
        const universe = await getB3Universe();
        const query = normalizeTicker(req.query.q || '');
        const filteredSymbols = query
            ? universe.symbols.filter((symbol) => symbol.includes(query))
            : universe.symbols;
        const page = paginateSymbols(filteredSymbols, req);

        res.json({
            source: universe.source,
            total: filteredSymbols.length,
            limit: page.limit,
            offset: page.offset,
            nextOffset: page.nextOffset,
            symbols: page.page,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: `Assets error: ${err.message}` });
    }
});

app.get('/api/summary', async (req, res) => {
    try {
        if (!API_KEY) {
            return res.status(500).json({
                error: 'BRAPI_TOKEN is not configured. Set it as an environment variable.',
            });
        }

        const signals = await Promise.all(symbols.map((symbol) => buildSignal(symbol)));
        const strongest = [...signals].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0] || null;
        const springs = signals.filter((item) => item.signal === 'Spring').length;
        const upthrusts = signals.filter((item) => item.signal === 'Upthrust').length;
        const averageRisk = Math.round(average(signals.map((item) => item.riskScore)));

        res.json({
            updatedAt: new Date().toISOString(),
            symbols,
            averageRisk,
            springs,
            upthrusts,
            strongest,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: `API error: ${err.message}` });
    }
});

app.get('/api/agents/news', async (req, res) => {
    try {
        const news = await analyzeMarketNews();
        res.json(news);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: `News agent error: ${err.message}` });
    }
});

app.get('/api/agents/b3', async (req, res) => {
    try {
        if (!API_KEY) {
            return res.status(500).json({
                error: 'BRAPI_TOKEN is not configured. Set it as an environment variable.',
            });
        }

        const requestedSymbols = uniqueSymbols(String(req.query.symbols || '').split(','));
        const selectedSymbols = requestedSymbols.length > 0 ? requestedSymbols : symbols;
        const fallbackSignals = await Promise.all(selectedSymbols.map((symbol) => buildSignal(symbol)));
        const b3Agent = await analyzeB3Realtime(selectedSymbols, fallbackSignals);

        res.json(b3Agent);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: `B3 agent error: ${err.message}` });
    }
});

app.get('/api/agents', async (req, res) => {
    try {
        if (!API_KEY) {
            return res.status(500).json({
                error: 'BRAPI_TOKEN is not configured. Set it as an environment variable.',
            });
        }

        const requestedSymbols = uniqueSymbols(String(req.query.symbols || '').split(','));
        const selectedSymbols = requestedSymbols.length > 0 ? requestedSymbols : symbols;
        const fallbackSignals = await Promise.all(selectedSymbols.map((symbol) => buildSignal(symbol)));
        const [news, b3] = await Promise.all([
            analyzeMarketNews(),
            analyzeB3Realtime(selectedSymbols, fallbackSignals),
        ]);

        res.json({ updatedAt: new Date().toISOString(), news, b3 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: `Agents error: ${err.message}` });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
