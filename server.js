const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const port = 3000;
const API_KEY = '7F8LKkWRb49vkYZsb6J5i9';
const symbols = ['PETR4', 'VALE3', 'ITUB4'];

app.use(cors());
app.use(express.json());

const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wyckoff Signals - Dark Mode</title>
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
        <h1>🪂 Wyckoff Signals (Spring / Upthrust)</h1>
        <div id="signals" class="loading">Loading signals...</div>
    </div>
    <script>
        async function fetchSignals() {
            try {
                const res = await fetch('/api/signals');
                const data = await res.json();
                let tableHtml = '<table><tr><th>Symbol</th><th>Signal</th><th>Price</th><th>Change %</th></tr>';
                data.forEach(s => {
                    const cls = s.signal === 'Spring' ? 'spring' : s.signal === 'Upthrust' ? 'upthrust' : 'none';
                    tableHtml += `<tr>
                        <td>${s.symbol}</td>
                        <td><span class="signal ${cls}">${s.signal}</span></td>
                        <td>${s.price}</td>
                        <td>${s.change.toFixed(2)}%</td>
                    </tr>`;
                });
                tableHtml += '</table>';
                document.getElementById('signals').innerHTML = tableHtml;
            } catch (e) {
                document.getElementById('signals').innerHTML = '<p style="color: red;">Error loading signals. Check console.</p>';
                console.error(e);
            }
        }

        fetchSignals();
        setInterval(fetchSignals, 30000); // Refresh every 30 seconds
    </script>
</body>
</html>
`;

app.get('/', (req, res) => {
    res.send(html);
});

app.get('/api/signals', async (req, res) => {
    try {
        const signals = [];
        for (const symbol of symbols) {
            // Fetch historical 5min candles
            const histUrl = `https://brapi.dev/api/historical-data?symbol=${symbol}&interval=5min&range=2D&apikey=${API_KEY}`;
            const histRes = await axios.get(histUrl);
            const candles = histRes.data.candles || [];

            if (candles.length < 20) {
                signals.push({ symbol, signal: 'None', price: 'N/A', change: 0 });
                continue;
            }

            const recent = candles.slice(-20);
            const lows = recent.map(c => parseFloat(c.low));
            const highs = recent.map(c => parseFloat(c.high));
            const prevMinLow = Math.min(...lows.slice(0, -1));
            const prevMaxHigh = Math.max(...highs.slice(0, -1));
            const last = recent[recent.length - 1];
            const lastLow = parseFloat(last.low);
            const lastHigh = parseFloat(last.high);
            const lastClose = parseFloat(last.close);

            let signal = 'None';

            // Spring: low breaks previous min low, but closes above it
            if (lastLow < prevMinLow && lastClose > prevMinLow) {
                signal = 'Spring';
            }
            // Upthrust: high breaks previous max high, but closes below it
            else if (lastHigh > prevMaxHigh && lastClose < prevMaxHigh) {
                signal = 'Upthrust';
            }

            // Fetch current quote
            const quoteUrl = `https://brapi.dev/api/quote/${symbol}?apikey=${API_KEY}`;
            const quoteRes = await axios.get(quoteUrl);
            const quote = quoteRes.data;
            const price = quote.price ? parseFloat(quote.price).toFixed(2) : parseFloat(last.close).toFixed(2);
            const change = quote.change_percent || quote.changes || 0;

            signals.push({ symbol, signal, price, change });
        }
        res.json(signals);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'API error: ' + err.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
