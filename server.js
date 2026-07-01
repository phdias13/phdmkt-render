// PhD!mkt — Render Service (HTML -> PNG) | substitui o HCTI
// POST /render  { html, width?, height?, delay?, fullPage?, binary? }
//   - padrão: devolve JSON { url } (igual ao HCTI) — a imagem fica disponível em /img/:id
//   - com "binary": true -> devolve o PNG direto (image/png)
// Header obrigatório: x-render-token: <RENDER_TOKEN>
// GET /img/:id.png -> serve a imagem gerada (expira em 1h)
// GET /health

const express = require("express");
const puppeteer = require("puppeteer");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "8mb" }));

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.RENDER_TOKEN || "";
const TTL_MS = 60 * 60 * 1000; // 1h

const store = new Map();
function putImage(buf) {
  const id = crypto.randomBytes(8).toString("hex");
  store.set(id, { buf, exp: Date.now() + TTL_MS });
  return id;
}
setInterval(() => {
  const now = Date.now();
  for (const [id, v] of store) if (v.exp < now) store.delete(id);
}, 5 * 60 * 1000).unref();

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    });
  }
  return browserPromise;
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "phdmkt-render" }));

app.get("/img/:id", (req, res) => {
  const id = String(req.params.id).replace(/\.png$/i, "");
  const item = store.get(id);
  if (!item || item.exp < Date.now()) return res.status(404).json({ error: "not found or expired" });
  res.set("Content-Type", "image/png");
  return res.send(item.buf);
});

app.post("/render", async (req, res) => {
  try {
    if (TOKEN && req.get("x-render-token") !== TOKEN) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const { html, width = 1080, height = 1350, delay = 2500, fullPage = false, binary = false } = req.body || {};
    if (!html) return res.status(400).json({ error: "missing html" });

    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: Number(width), height: Number(height), deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
    await new Promise((r) => setTimeout(r, Number(delay)));
    try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch (_) {}

    const png = await page.screenshot({ type: "png", fullPage: Boolean(fullPage) });
    await page.close();

    if (binary) {
      res.set("Content-Type", "image/png");
      return res.send(png);
    }
    const id = putImage(png);
    const proto = (req.get("x-forwarded-proto") || "https").split(",")[0];
    const host = req.get("host");
    const url = `${proto}://${host}/img/${id}.png`;
    return res.json({ url, id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

app.listen(PORT, () => console.log(`phdmkt-render on :${PORT}`));
