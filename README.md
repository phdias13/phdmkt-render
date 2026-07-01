# PhD!mkt — Render Service (HTML → PNG)

Substitui o **HCTI** (R$73/mês → R$0). Roda no Railway que você já tem.
Endpoint: `POST /render` recebe HTML e devolve PNG. Mesmo papel do HCTI no WF-5.

## Arquivos
- `server.js` — API (Express + Puppeteer)
- `package.json` — dependências
- `Dockerfile` — imagem com Chromium pronto (Railway detecta e usa)

## Passo a passo do deploy (Railway) — você executa
1. Crie um repositório (GitHub) e suba esta pasta `render-service/` **ou** use o Railway CLI.
   - Via GitHub: New repo → suba os 4 arquivos → no Railway: **New Project → Deploy from GitHub repo**.
   - Via CLI: `npm i -g @railway/cli` → `railway login` → dentro da pasta: `railway init` → `railway up`.
2. No serviço, em **Variables**, defina:
   - `RENDER_TOKEN` = uma senha forte sua (qualquer string secreta). **Guarde — vai no n8n.**
3. O Railway dá uma URL pública (ex.: `https://phdmkt-render-production.up.railway.app`).
4. Teste a saúde: abra `…/health` → deve responder `{"ok":true,...}`.

> Eu não faço o deploy nem defino o token por você (envolve sua conta/segredo). Quando a URL estiver no ar, me passe a URL pública (não o token) que eu reescrevo o nó de render do WF-5 no n8n.

## Como o WF-5 vai chamar (eu configuro no n8n)
Nó **HTTP Request** no lugar do HCTI:
- Method: `POST`
- URL: `https://SUA-URL.up.railway.app/render`
- Header: `x-render-token: {{ $env.RENDER_TOKEN }}` (token salvo no cofre do n8n)
- Body (JSON): `{ "html": "={{ $json.html }}", "width": 1080, "height": 1350, "delay": 2500 }`
- Response: **File/Binary** (a resposta é a imagem PNG)

## Teste rápido (local, opcional)
```bash
npm install
RENDER_TOKEN=teste node server.js
# noutro terminal:
curl -X POST http://localhost:3000/render -H "x-render-token: teste" \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1 style=\"font-family:sans-serif\">Olá PhD!mkt</h1>","width":600,"height":400}' \
  --output teste.png
```
