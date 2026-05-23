# Analise de Mercado

Aplicativo Node.js/Express para exibir sinais de Wyckoff (Spring e Upthrust) usando dados da BRAPI.

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

## Deploy No Render

Crie um Web Service Node.js apontando para este repositorio.

- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `BRAPI_TOKEN`
