# Analise de Mercado

Aplicativo Node.js/Express para exibir sinais de Wyckoff (Spring e Upthrust), graficos e indicadores de risco usando dados da BRAPI.

## Recursos

- Painel com cards de risco medio, Springs, Upthrusts e maior movimento.
- Agente de noticias macro com Bloomberg Linea Mercados como fonte principal.
- Agente B3 para normalizar market data real-time quando houver conector autorizado.
- Adaptador Google Finance para cotacoes publicas `SYMBOL:BVMF` como fonte complementar.
- Grafico intraday por ativo.
- Grafico comparativo de variacao percentual.
- Tabela com preco, tendencia, RSI, volatilidade e risco.
- Filtro de ativos por lista separada por virgulas.
- Modo Todos B3 com monitoramento em lotes para ativos cadastrados/negociados em dias uteis.
- API com dados enriquecidos para reutilizar em outros frontends.

## Como Rodar Localmente

```bash
npm install
BRAPI_TOKEN=seu_token npm start
```

No Windows PowerShell:

```powershell
$env:BRAPI_TOKEN="seu_token"
npm start
```

Depois acesse `http://localhost:3000`.

## Variaveis De Ambiente

- `BRAPI_TOKEN`: token da BRAPI. Obrigatorio para consultar dados.
- `PORT`: porta do servidor. O Render define automaticamente.
- `SYMBOLS`: lista opcional de ativos separados por virgula. Padrao: `PETR4,VALE3,ITUB4`.
- `NEWS_FEEDS`: lista opcional de RSS no formato `Escopo|URL,Escopo|URL`.
- `BLOOMBERG_MARKETS_URL`: pagina de mercados da Bloomberg Linea usada pelo agente de noticias.
- `GOOGLE_FINANCE_ENABLED`: habilita ou desabilita o adaptador Google Finance. Padrao: `true`.
- `GOOGLE_FINANCE_EXCHANGE`: bolsa usada nos tickers do Google Finance. Padrao: `BVMF`.
- `B3_MARKET_DATA_URL`: endpoint de market data B3 contratado/autorizado.
- `B3_MARKET_DATA_KEY`: token opcional para o conector B3.
- `B3_MARKET_DATA_PROVIDER`: nome do vendor/sub-vendor usado no conector.
- `B3_ALL_SYMBOLS`: lista completa de ativos B3 separados por virgula, caso voce queira controlar o universo manualmente.
- `B3_ASSETS_URL`: endpoint autorizado que retorna a lista de ativos cadastrados/negociados na B3.
- `B3_ASSETS_TOKEN`: token opcional para o endpoint definido em `B3_ASSETS_URL`.
- `DADOS_MERCADO_TOKEN`: token opcional para buscar o universo em `https://api.dadosdemercado.com.br/v1/tickers`.
- `MONITOR_BATCH_SIZE`: quantidade padrao de ativos monitorados por lote no modo Todos B3. Padrao: `12`.

Observacao: a B3 oferece Market Data por plataformas e distribuidores autorizados. Sem `B3_MARKET_DATA_URL`, o agente B3 tenta Google Finance para cotacao publica e usa BRAPI como fallback/modelagem.
Para monitorar todos os ativos oficiais em tempo real, configure um endpoint/token autorizado em `B3_ASSETS_URL` ou `DADOS_MERCADO_TOKEN`. Sem essas credenciais, o app usa uma lista local de fallback com ativos liquidos da B3.

## Endpoints

- `GET /`: interface web.
- `GET /healthz`: status simples para monitoramento.
- `GET /api/signals`: sinais e indicadores para os ativos padrao.
- `GET /api/signals?symbols=PETR4,VALE3`: sinais e indicadores para uma lista customizada.
- `GET /api/signals?all=true&limit=12&offset=0`: monitora o universo B3 em lotes.
- `GET /api/assets`: lista os ativos disponiveis no universo B3 configurado.
- `GET /api/summary`: resumo agregado dos ativos configurados.
- `GET /api/agents/news`: agente de noticias macro.
- `GET /api/agents/b3`: agente de dados B3/modelagem.
- `GET /api/agents`: resposta combinada dos dois agentes.

## Deploy No Render

Crie um Web Service Node.js apontando para este repositorio.

- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `BRAPI_TOKEN`
