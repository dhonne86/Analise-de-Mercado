const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;
const API_KEY = process.env.BRAPI_TOKEN || '';
const symbols = (process.env.SYMBOLS || 'PETR4,VALE3,ITUB4')
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

app.use(cors());
app.use(express.json());

const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sinais Wyckoff - Análise de Mercado</title>
    <style>
        body {
            background: #121212;
            color: #ffffff;
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        h1 {
            text-align: center;
            color: #00ff88;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #333;
        }
        th {
            background: #1e1e1e;
            font-weight: bold;
        }
        .signal {
            font-weight: bold;
            padding: 5px 10px;
            border-radius: 5px;
        }
        .spring {
            background: #004d00;
            color: #00ff00;
        }
        .upthrust {
            background: #4d0000;
            color: #ff0000;
        }
        .none {
            color: #888;
        }
        .loading {
            text-align: center;
            font-style: italic;
            color: #888;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Sinais Wyckoff (Spring / Upthrust)</h1>
        <div id="signals" class="loading">Carregando sinais...</div>
    </div>
    <script>
        async function fetchSignals() {
            try {
                const res = await fetch('/api/signals');
                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.error || 'Erro ao carregar sinais.');
                }

                let tableHtml = '<table><tr><th>Ativo</th><th>Sinal</th><th>Preço</th><th>Variação %</th></tr>';
                data.forEach(s => {
                    const cls = s.signal === 'Spring' ? 'spring' : s.signal === 'Upthrust' ? 'upthrust' : 'none';
                    tableHtml += '<tr>' +
                        '<td>' + s.symbol + '</td>' +
                        '<td><span class="signal ' + cls + '">' + s.signal + '</span></td>' +
                        '<td>' + s.price + '</td>' +
                        '<td>' + Number(s.change || 0).toFixed(2) + '%</td>' +
                    '</tr>';
                });
                tableHtml += '</table>';
                document.getElementById('signals').innerHTML = tableHtml;
            } catch (e) {
                document.getElementById('signals').innerHTML = '<p style="color: red;">Erro ao carregar sinais. Verifique a configuração do servidor.</p>';
                console.error(e);
            }
        }

        fetchSignals();
        setInterval(fetchSignals, 30000);
    </script>
</body>
</html>
`;

app.get('/', (req, res) => {
    res.send(html);
});

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

function parseNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

app.get('/api/signals', async (req, res) => {
    try {
        if (!API_KEY) {
            return res.status(500).json({
                error: 'BRAPI_TOKEN is not configured. Set it as an environment variable.',
            });
        }

        const signals = [];

        for (const symbol of symbols) {
            const histUrl = `https://brapi.dev/api/historical-data?symbol=${encodeURIComponent(symbol)}&interval=5min&range=2D&token=${encodeURIComponent(API_KEY)}`;
            const histRes = await axios.get(histUrl);
            const candles = getHistoricalCandles(histRes.data);

            if (candles.length < 20) {
                signals.push({ symbol, signal: 'None', price: 'N/A', change: 0 });
                continue;
            }

            const recent = candles.slice(-20);
            const lows = recent.map((c) => parseNumber(c.low));
            const highs = recent.map((c) => parseNumber(c.high));
            const prevMinLow = Math.min(...lows.slice(0, -1));
            const prevMaxHigh = Math.max(...highs.slice(0, -1));
            const last = recent[recent.length - 1];
            const lastLow = parseNumber(last.low);
            const lastHigh = parseNumber(last.high);
            const lastClose = parseNumber(last.close);

            let signal = 'None';

            if (lastLow < prevMinLow && lastClose > prevMinLow) {
                signal = 'Spring';
            } else if (lastHigh > prevMaxHigh && lastClose < prevMaxHigh) {
                signal = 'Upthrust';
            }

            const quoteUrl = `https://brapi.dev/api/quote/${encodeURIComponent(symbol)}?token=${encodeURIComponent(API_KEY)}`;
            const quoteRes = await axios.get(quoteUrl);
            const quote = getQuoteResult(quoteRes.data);
            const rawPrice = quote.regularMarketPrice ?? quote.price ?? lastClose;
            const rawChange = quote.regularMarketChangePercent ?? quote.change_percent ?? quote.changes ?? 0;
            const price = parseNumber(rawPrice, lastClose).toFixed(2);
            const change = parseNumber(rawChange);

            signals.push({ symbol, signal, price, change });
        }

        res.json(signals);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: `API error: ${err.message}` });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
