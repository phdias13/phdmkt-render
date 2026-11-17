// PhD!mkt — Render Service (HTML/URL -> PNG) | substitui o HCTI
// POST /render  { html | url, width?, height?, delay?, fullPage?, binary? }
//   - padrão: devolve JSON { url } (igual ao HCTI) — a imagem fica disponível em /img/:id
//   - com "binary": true -> devolve o PNG direto (image/png)
// Header obrigatório: x-render-token: <RENDER_TOKEN>
// GET /img/:id.png -> serve a imagem gerada (expira em 1h)
// GET /health
//
// A11 da auditoria de 14/11/2026 (repositório ecossistema-hq,
// docs/auditoria/anexos/03-ferramentas.md R-1 a R-3):
//   - o token deixou de ser opcional: sem RENDER_TOKEN o serviço recusa tudo;
//   - comparação do token em tempo constante;
//   - a página renderizada NÃO acessa a rede: só `data:`/`blob:` e os hosts
//     de RENDER_ALLOWED_HOSTS (fontes, imagens do próprio sistema). Antes,
//     HTML arbitrário podia buscar endereços internos (SSRF), inclusive o
//     endereço de metadados da nuvem;
//   - `url` passa a ser aceito (é o que o Ecossistema envia), mas só para
//     hosts de RENDER_ALLOWED_HOSTS;
//   - tetos para largura, altura, espera, tamanho do HTML e páginas abertas.

const express = require("express");
const puppeteer = require("puppeteer");
const crypto = require("crypto");

const LIMITES = Object.freeze({
  largura: 4000,
  altura: 8000,
  espera_ms: 10000,
  html_bytes: 4 * 1024 * 1024,
  paginas_simultaneas: 4,
  carregamento_ms: 30000,
});

function lerHostsPermitidos(valor) {
  return String(valor || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostPermitido(urlTexto, permitidos) {
  let u;
  try { u = new URL(urlTexto); } catch { return false; }
  if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return true;
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  return permitidos.some((p) => host === p || host.endsWith(`.${p}`));
}

function tokenConfere(recebido, esperado) {
  if (!esperado) return false;
  const a = crypto.createHash("sha256").update(String(recebido || "")).digest();
  const b = crypto.createHash("sha256").update(String(esperado)).digest();
  return crypto.timingSafeEqual(a, b);
}

function numeroEntre(valor, padrao, min, max) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(Math.round(n), min), max);
}

function validarPedido(corpo, permitidos) {
  const { html, url } = corpo || {};
  if (!html && !url) return { erro: "envie html ou url" };
  if (html && url) return { erro: "envie html OU url, nao os dois" };
  if (html && Buffer.byteLength(String(html)) > LIMITES.html_bytes) return { erro: "html grande demais" };
  if (url && !hostPermitido(url, permitidos)) return { erro: "url fora de RENDER_ALLOWED_HOSTS" };
  return {
    html: html ? String(html) : null,
    url: url ? String(url) : null,
    width: numeroEntre(corpo.width, 1080, 100, LIMITES.largura),
    height: numeroEntre(corpo.height, 1350, 100, LIMITES.altura),
    delay: numeroEntre(corpo.delay, 2500, 0, LIMITES.espera_ms),
    fullPage: Boolean(corpo.fullPage),
    binary: Boolean(corpo.binary),
  };
}

function criarApp({ token = process.env.RENDER_TOKEN || "", permitidos = lerHostsPermitidos(process.env.RENDER_ALLOWED_HOSTS), lancarNavegador } = {}) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  const TTL_MS = 60 * 60 * 1000; // 1h
  const store = new Map();
  function putImage(buf) {
    const id = crypto.randomBytes(16).toString("hex");
    store.set(id, { buf, exp: Date.now() + TTL_MS });
    return id;
  }
  setInterval(() => {
    const now = Date.now();
    for (const [id, v] of store) if (v.exp < now) store.delete(id);
  }, 5 * 60 * 1000).unref();

  let browserPromise = null;
  const abrir = lancarNavegador || (() => puppeteer.launch({
    headless: "new",
    // `--no-sandbox` continua porque o container roda sem as permissões que o
    // sandbox do Chromium exige; o que contém o risco agora é o bloqueio de
    // rede da página e a lista de hosts.
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  }));
  async function getBrowser() {
    if (!browserPromise) browserPromise = abrir();
    return browserPromise;
  }
  let abertas = 0;

  app.get("/health", (_req, res) => res.json({ ok: true, service: "phdmkt-render", token_configurado: Boolean(token) }));

  app.get("/img/:id", (req, res) => {
    const id = String(req.params.id).replace(/\.png$/i, "");
    const item = store.get(id);
    if (!item || item.exp < Date.now()) return res.status(404).json({ error: "not found or expired" });
    res.set("Content-Type", "image/png");
    return res.send(item.buf);
  });

  app.post("/render", async (req, res) => {
    if (!token) return res.status(503).json({ error: "RENDER_TOKEN nao configurado: o servico recusa pedidos" });
    if (!tokenConfere(req.get("x-render-token"), token)) return res.status(401).json({ error: "unauthorized" });
    const pedido = validarPedido(req.body, permitidos);
    if (pedido.erro) return res.status(400).json({ error: pedido.erro });
    if (abertas >= LIMITES.paginas_simultaneas) return res.status(429).json({ error: "ocupado, tente de novo" });
    abertas += 1;
    let page;
    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", (r) => {
        if (hostPermitido(r.url(), permitidos)) r.continue();
        else r.abort("blockedbyclient");
      });
      await page.setViewport({ width: pedido.width, height: pedido.height, deviceScaleFactor: 2 });
      if (pedido.url) await page.goto(pedido.url, { waitUntil: "networkidle0", timeout: LIMITES.carregamento_ms });
      else await page.setContent(pedido.html, { waitUntil: "networkidle0", timeout: LIMITES.carregamento_ms });
      await new Promise((r) => setTimeout(r, pedido.delay));
      try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch (_) {}
      const png = await page.screenshot({ type: "png", fullPage: pedido.fullPage });
      if (pedido.binary) {
        res.set("Content-Type", "image/png");
        return res.send(png);
      }
      const id = putImage(png);
      const proto = (req.get("x-forwarded-proto") || "https").split(",")[0];
      const host = req.get("host");
      return res.json({ url: `${proto}://${host}/img/${id}.png`, id });
    } catch (err) {
      console.error("[render] falha:", err && err.message ? err.message : err);
      return res.status(500).json({ error: "falha ao renderizar" });
    } finally {
      abertas -= 1;
      if (page) page.close().catch(() => {});
    }
  });

  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  if (!process.env.RENDER_TOKEN) console.warn("[render] RENDER_TOKEN ausente: todo POST /render sera recusado com 503.");
  criarApp().listen(PORT, () => console.log(`phdmkt-render on :${PORT}`));
}

module.exports = { criarApp, validarPedido, hostPermitido, tokenConfere, lerHostsPermitidos, LIMITES };
