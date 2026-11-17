"use strict";

/* A11 (auditoria de 14/11/2026): o servico de render deixa de ser aberto. */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { criarApp, validarPedido, hostPermitido, tokenConfere } = require("../server");

const PERMITIDOS = ["firma.exemplo.com", "fonts.gstatic.com"];

test("so passam hosts da lista; metadados da nuvem e rede interna nao", () => {
  assert.equal(hostPermitido("https://firma.exemplo.com/render-job/1", PERMITIDOS), true);
  assert.equal(hostPermitido("https://cdn.firma.exemplo.com/x.png", PERMITIDOS), true);
  assert.equal(hostPermitido("data:image/png;base64,AAAA", PERMITIDOS), true);
  for (const ruim of ["http://169.254.169.254/latest/meta-data/", "http://localhost:3001/api/users", "http://10.0.0.5/", "file:///etc/passwd", "https://firma.exemplo.com.atacante.io/"]) {
    assert.equal(hostPermitido(ruim, PERMITIDOS), false, ruim);
  }
});

test("pedido tem tetos e exige html ou url", () => {
  assert.match(validarPedido({}, PERMITIDOS).erro, /html ou url/);
  assert.match(validarPedido({ url: "http://169.254.169.254/" }, PERMITIDOS).erro, /RENDER_ALLOWED_HOSTS/);
  const p = validarPedido({ html: "<p>oi</p>", width: 99999, height: -5, delay: 999999 }, PERMITIDOS);
  assert.equal(p.width, 4000);
  assert.equal(p.height, 100);
  assert.equal(p.delay, 10000);
});

test("token obrigatorio e comparado direito", () => {
  assert.equal(tokenConfere("abc", ""), false, "sem token configurado ninguem passa");
  assert.equal(tokenConfere("abc", "abc"), true);
  assert.equal(tokenConfere("abd", "abc"), false);
});

function pedir(porta, { token, corpo }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(corpo);
    const req = http.request({ hostname: "127.0.0.1", port: porta, path: "/render", method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-render-token": token } : {}) } }, (r) => {
      let d = ""; r.on("data", (c) => { d += c; }); r.on("end", () => resolve({ status: r.statusCode, corpo: d }));
    });
    req.on("error", reject); req.end(body);
  });
}

test("HTTP: sem token configurado responde 503; token errado 401; a pagina bloqueia rede fora da lista", async (t) => {
  const bloqueadas = [];
  const navegadorFalso = async () => ({
    newPage: async () => {
      let ouvinte;
      return {
        setRequestInterception: async () => {},
        on: (_ev, fn) => { ouvinte = fn; },
        setViewport: async () => {},
        setContent: async () => {
          for (const u of ["http://169.254.169.254/latest/meta-data/", "https://fonts.gstatic.com/a.woff2"]) {
            ouvinte({ url: () => u, continue: () => {}, abort: () => bloqueadas.push(u) });
          }
        },
        goto: async () => {},
        evaluate: async () => {},
        screenshot: async () => Buffer.from("png"),
        close: async () => {},
      };
    },
  });
  const sem = criarApp({ token: "", permitidos: PERMITIDOS, lancarNavegador: navegadorFalso }).listen(0);
  const com = criarApp({ token: "segredo", permitidos: PERMITIDOS, lancarNavegador: navegadorFalso }).listen(0);
  t.after(() => { sem.close(); com.close(); });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await pedir(sem.address().port, { token: "x", corpo: { html: "<p>oi</p>" } })).status, 503);
  assert.equal((await pedir(com.address().port, { token: "errado", corpo: { html: "<p>oi</p>" } })).status, 401);
  const ok = await pedir(com.address().port, { token: "segredo", corpo: { html: "<p>oi</p>", delay: 0 } });
  assert.equal(ok.status, 200, ok.corpo);
  assert.deepEqual(bloqueadas, ["http://169.254.169.254/latest/meta-data/"]);
});
