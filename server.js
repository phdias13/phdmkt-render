// PhD!mkt — Render Service (HTML -> PNG) | substitui o HCTI
// POST /render  { html, width?, height?, delay?, fullPage? }  -> image/png
// Header obrigatório: x-render-token: <RENDER_TOKEN>
// Saúde: GET /health

const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
app.use(express.json({ limit: "8mb" }));

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.RENDER_TOKEN || ""; // defina no Railway

// Navegador reaproveitado entre requisições (mais rápido)
let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--font-render-hinting=none",
      ],
    });
  }
  return browserPromise;
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "phdmkt-render" }));

app.post("/render", async (req, res) => {
  try {
    if (TOKEN && req.get("x-render-token") !== TOKEN) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const {
      html,
      width = 1080,
      height = 1350,
      delay = 2500,      // tempo p/ Pollinations + Google Fonts carregarem
      fullPage = false,
    } = req.body || {};

    if (!html) return res.status(400).json({ error: "missing html" });

    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: Number(width), height: Number(height), deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
    // espera extra p/ imagens externas (Pollinations) e fontes
    await new Promise((r) => setTimeout(r, Number(delay)));
    try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch (_) {}

    const png = await page.screenshot({ type: "png", fullPage: Boolean(fullPage) });
    await page.close();

    res.set("Content-Type", "image/png");
    return res.send(png);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

app.listen(PORT, () => console.log(`phdmkt-render on :${PORT}`));
