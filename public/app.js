let priceChart;
let changeChart;
let latestSignals = [];

const elements = {
  form: document.querySelector('#symbols-form'),
  input: document.querySelector('#symbols-input'),
  chartSymbol: document.querySelector('#chart-symbol'),
  cards: document.querySelector('#cards'),
  table: document.querySelector('#signals-table'),
  averageRisk: document.querySelector('#average-risk'),
  springCount: document.querySelector('#spring-count'),
  upthrustCount: document.querySelector('#upthrust-count'),
  strongestSymbol: document.querySelector('#strongest-symbol'),
  updatedAt: document.querySelector('#updated-at'),
  priceTitle: document.querySelector('#price-title'),
  toast: document.querySelector('#toast'),
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 6000);
}

function signalClass(signal) {
  if (signal === 'Spring') return 'spring';
  if (signal === 'Upthrust') return 'upthrust';
  return 'none';
}

function formatPercent(value) {
  const number = Number(value || 0);
  return `${number.toFixed(2)}%`;
}

function formatNumber(value, fallback = '--') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return fallback;
  return Number(value).toFixed(2);
}

function updateSummary(signals) {
  const averageRisk = signals.length
    ? Math.round(signals.reduce((sum, item) => sum + Number(item.riskScore || 0), 0) / signals.length)
    : 0;
  const strongest = [...signals].sort((a, b) => Math.abs(Number(b.change || 0)) - Math.abs(Number(a.change || 0)))[0];

  elements.averageRisk.textContent = averageRisk;
  elements.springCount.textContent = signals.filter((item) => item.signal === 'Spring').length;
  elements.upthrustCount.textContent = signals.filter((item) => item.signal === 'Upthrust').length;
  elements.strongestSymbol.textContent = strongest ? strongest.symbol : '--';
  elements.updatedAt.textContent = new Date().toLocaleString('pt-BR');
}

function renderCards(signals) {
  elements.cards.innerHTML = signals
    .map(
      (item) => `
        <article class="asset-card">
          <header>
            <div>
              <h3>${item.symbol}</h3>
              <span>${item.trend}</span>
            </div>
            <span class="badge ${signalClass(item.signal)}">${item.signal}</span>
          </header>
          <div class="metrics">
            <div><span>Preco</span><strong>${item.price}</strong></div>
            <div><span>Variacao</span><strong class="${Number(item.change) >= 0 ? 'positive' : 'negative'}">${formatPercent(item.change)}</strong></div>
            <div><span>RSI</span><strong>${formatNumber(item.rsi)}</strong></div>
            <div><span>Risco</span><strong>${item.riskScore}/100</strong></div>
            <div><span>Suporte</span><strong>${formatNumber(item.support)}</strong></div>
            <div><span>Resistencia</span><strong>${formatNumber(item.resistance)}</strong></div>
          </div>
        </article>
      `,
    )
    .join('');
}

function renderTable(signals) {
  elements.table.innerHTML = signals
    .map(
      (item) => `
        <tr>
          <td>${item.symbol}</td>
          <td><span class="badge ${signalClass(item.signal)}">${item.signal}</span></td>
          <td>${item.price}</td>
          <td class="${Number(item.change) >= 0 ? 'positive' : 'negative'}">${formatPercent(item.change)}</td>
          <td>${item.trend}</td>
          <td>${formatNumber(item.rsi)}</td>
          <td>${formatPercent(item.volatility)}</td>
          <td>${item.riskScore}/100</td>
        </tr>
      `,
    )
    .join('');
}

function renderSymbolOptions(signals) {
  const current = elements.chartSymbol.value;
  elements.chartSymbol.innerHTML = signals.map((item) => `<option value="${item.symbol}">${item.symbol}</option>`).join('');
  if (signals.some((item) => item.symbol === current)) {
    elements.chartSymbol.value = current;
  }
}

function candleLabel(candle, index) {
  if (!candle.date) return `#${index + 1}`;
  const date = new Date(candle.date);
  if (Number.isNaN(date.getTime())) return String(candle.date).slice(-8);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function renderPriceChart(symbol) {
  const item = latestSignals.find((signal) => signal.symbol === symbol) || latestSignals[0];
  if (!item) return;

  elements.priceTitle.textContent = `Serie intraday - ${item.symbol}`;

  const labels = item.candles.map(candleLabel);
  const prices = item.candles.map((candle) => candle.close);

  if (priceChart) priceChart.destroy();
  priceChart = new Chart(document.querySelector('#price-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: item.symbol,
          data: prices,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.12)',
          tension: 0.25,
          fill: true,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#98a4b5', maxTicksLimit: 6 }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y: { ticks: { color: '#98a4b5' }, grid: { color: 'rgba(255,255,255,0.06)' } },
      },
    },
  });
}

function renderChangeChart(signals) {
  if (changeChart) changeChart.destroy();
  changeChart = new Chart(document.querySelector('#change-chart'), {
    type: 'bar',
    data: {
      labels: signals.map((item) => item.symbol),
      datasets: [
        {
          label: 'Variacao %',
          data: signals.map((item) => item.change),
          backgroundColor: signals.map((item) => (Number(item.change) >= 0 ? '#22c55e' : '#ef4444')),
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#98a4b5' }, grid: { display: false } },
        y: { ticks: { color: '#98a4b5' }, grid: { color: 'rgba(255,255,255,0.06)' } },
      },
    },
  });
}

async function loadSignals(symbols) {
  const query = symbols ? `?symbols=${encodeURIComponent(symbols)}` : '';
  const response = await fetch(`/api/signals${query}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Falha ao carregar dados.');
  }

  latestSignals = data;
  updateSummary(data);
  renderCards(data);
  renderTable(data);
  renderSymbolOptions(data);
  renderPriceChart(elements.chartSymbol.value || data[0]?.symbol);
  renderChangeChart(data);
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  loadSignals(elements.input.value).catch((error) => showToast(error.message));
});

elements.chartSymbol.addEventListener('change', () => {
  renderPriceChart(elements.chartSymbol.value);
});

loadSignals(elements.input.value).catch((error) => showToast(error.message));
window.setInterval(() => {
  loadSignals(elements.input.value).catch((error) => showToast(error.message));
}, 30000);
