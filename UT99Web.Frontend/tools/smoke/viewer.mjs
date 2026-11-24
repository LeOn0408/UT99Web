#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "../..");
const STATIC_PORT = 8137;
const TOTAL_TIMEOUT_MS = 60000;
const LOAD_TIMEOUT_MS = 45000;
const CHROME = process.env.CHROME_PATH
  || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

let staticServer = null;
let chrome = null;
let cdp = null;
let profileDir = null;
let screenshotPath = null;
let cleaned = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  throw new Error(message);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: таймаут ${ms} мс`)), ms))
  ]);
}

async function getJson(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.problems = [];
    this.requests = [];
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (event) => this.onMessage(event));
  }

  async open() {
    await withTimeout(new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", () => reject(new Error("CDP WebSocket: ошибка соединения")), { once: true });
    }), 10000, "CDP WebSocket");
  }

  onMessage(event) {
    let message;
    try {
      const text = typeof event.data === "string"
        ? event.data
        : Buffer.from(event.data).toString("utf8");
      message = JSON.parse(text);
    } catch {
      return;
    }

    if (message.id) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result ?? {});
      return;
    }

    this.onEvent(message);
  }

  onEvent(message) {
    const { method, params } = message;
    if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails ?? {};
      const text = details.exception?.description || details.text || "исключение";
      this.problems.push(`исключение: ${text}`);
      return;
    }
    if (method === "Runtime.consoleAPICalled" && params.type === "error") {
      const text = (params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.type)
        .join(" ");
      if (!/favicon/i.test(text)) this.problems.push(`console.error: ${text}`);
      return;
    }
    if (method === "Log.entryAdded" && params.entry?.level === "error") {
      const text = `${params.entry.text ?? ""} ${params.entry.url ?? ""}`.trim();
      if (!/favicon/i.test(text)) this.problems.push(`log: ${text}`);
      return;
    }
    if (method === "Network.requestWillBeSent") {
      const url = params.request?.url ?? "";
      if (url && !/favicon\.ico/i.test(url)) this.requests.push(url);
    }
  }

  send(method, params = {}) {
    if (this.ws.readyState !== 1) {
      return Promise.reject(new Error(`CDP ${method}: соединение закрыто`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method}: таймаут`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.ws.close(); } catch { /* уже закрыт */ }
  }
}

async function startStaticServer() {
  staticServer = spawn(process.execPath, ["tools/serve.mjs"], {
    cwd: frontendRoot,
    env: { ...process.env, PORT: String(STATIC_PORT) },
    stdio: "ignore",
    windowsHide: true
  });

  const url = `http://localhost:${STATIC_PORT}/web/viewer.html`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (staticServer.exitCode !== null) {
      fail(`статический сервер завершился с кодом ${staticServer.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return url;
    } catch {
      // сервер ещё не поднялся
    }
    await sleep(200);
  }
  fail("статический сервер не ответил за 15 с");
}

async function readDebugPort(child) {
  const file = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`Chrome завершился с кодом ${child.exitCode}`);
    }
    if (fs.existsSync(file)) {
      try {
        const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
        const port = Number(lines[0]);
        if (Number.isInteger(port) && port > 0) return port;
      } catch {
        // файл ещё дописывается
      }
    }
    await sleep(200);
  }
  fail("Chrome не создал DevToolsActivePort за 20 с");
}

async function waitForPage(port, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`Chrome завершился с кодом ${child.exitCode}`);
    }
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      const page = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // CDP ещё не готов
    }
    await sleep(200);
  }
  fail("CDP не отдал страницу за 15 с");
}

function launchChrome(url) {
  if (!fs.existsSync(CHROME)) {
    fail(`Chrome не найден: ${CHROME}. Укажите CHROME_PATH.`);
  }
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ut99web-smoke-"));
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--window-size=800,600",
    "--use-angle=d3d11",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    url
  ];
  chrome = spawn(CHROME, args, { stdio: "ignore", windowsHide: true });
  chrome.on("error", (error) => {
    console.error(`FAIL: не удалось запустить Chrome: ${error.message}`);
    process.exit(1);
  });
}

const STATE_EXPRESSION = `(() => {
  const s = window.__threeState;
  const info = document.getElementById("info");
  const text = info ? info.textContent || "" : "";
  return {
    ready: !!s && text.length > 0
      && !/loading/i.test(text)
      && !/^ERROR/i.test(text)
      && (s.starts ? s.starts.length : 0) > 0
      && !!s.collision
      && s.mode === "walk",
    state: !!s,
    starts: s && s.starts ? s.starts.length : 0,
    collision: !!(s && s.collision),
    mode: s ? s.mode : null,
    lightmap: s ? (s.lightmapEnabled ? s.lightmapWidth + "x" + s.lightmapHeight : "off") : null,
    bakeMs: s ? s.lightmapBakeMs : null,
    pickups: s ? (s.pickups ? s.pickups.length : 0) : 0,
    pickupMeshes: s ? (s.pickupMeshes ?? 0) : 0,
    bots: s && s.bots ? s.bots.length : 0,
    botsAlive: s && s.bots ? s.bots.filter((bot) => bot.alive).length : 0,
    botShots: s ? (s.botShots ?? 0) : 0,
    botBlockedShots: s ? (s.botBlockedShots ?? 0) : 0,
    info: text
  };
})()`;

async function waitForViewer() {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression: STATE_EXPRESSION,
      returnByValue: true
    });
    if (evaluation.exceptionDetails) {
      const text = evaluation.exceptionDetails.exception?.description
        || evaluation.exceptionDetails.text
        || "ошибка evaluate";
      fail(`не удалось прочитать состояние вьюера: ${text}`);
    }
    last = evaluation.result?.value ?? null;
    if (last?.info?.startsWith("ERROR")) {
      fail(`вьюер сообщил об ошибке: ${last.info}`);
    }
    if (last?.ready) return last;
    await sleep(250);
  }
  fail(`карта не загрузилась за ${LOAD_TIMEOUT_MS} мс; info: ${last?.info ?? "(нет данных)"}`);
}

function validateRequests(baseUrl, requests) {
  const expected = new URL(baseUrl);
  const expectedPort = expected.port || (expected.protocol === "https:" ? "443" : "80");
  const external = [];
  for (const url of requests) {
    if (/^(data|blob|about):/i.test(url)) continue;
    try {
      const parsed = new URL(url);
      const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
      const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (!local || port !== expectedPort) external.push(url);
    } catch {
      external.push(url);
    }
  }
  if (external.length) {
    fail(`запросы на сторонние адреса:\n${external.map((item) => `  ${item}`).join("\n")}`);
  }
}

function validatePng(buffer, file) {
  if (buffer.length < 20 * 1024) {
    fail(`скриншот слишком маленький: ${buffer.length} байт (${file})`);
  }
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
    fail(`скриншот не является PNG: ${file}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 600 || height < 400) {
    fail(`неожиданный размер скриншота: ${width}x${height}`);
  }
  return { width, height };
}

async function killChild(child) {
  if (!child || child.exitCode !== null) return;
  const done = new Promise((resolve) => child.once("exit", resolve));
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
  } else {
    try { child.kill("SIGKILL"); } catch { /* уже завершён */ }
  }
  await Promise.race([done, sleep(5000)]);
}

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { cdp?.close(); } catch { /* ignore */ }
  await killChild(chrome);
  await killChild(staticServer);
  if (profileDir) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
        break;
      } catch {
        await sleep(200);
      }
    }
  }
}

async function run() {
  const baseUrl = process.env.SMOKE_URL
    || `${await startStaticServer()}?walk=1&menu=0`;
  const parsed = new URL(baseUrl);

  launchChrome(baseUrl);
  const port = await readDebugPort(chrome);
  const wsUrl = await waitForPage(port, chrome);

  cdp = new CdpClient(wsUrl);
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.navigate", { url: baseUrl });

  const loaded = await waitForViewer();
  validateRequests(baseUrl, cdp.requests);
  if (cdp.problems.length) {
    fail(`ошибки страницы:\n${cdp.problems.map((item) => `  ${item}`).join("\n")}`);
  }

  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      if (window.__threeState) window.__threeState.paused = true;
      const pause = document.getElementById("pause");
      if (pause) pause.classList.remove("is-on");
      return true;
    })()`,
    returnByValue: true
  });
  await sleep(300);

  const capture = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true
  });
  if (!capture?.data) fail("Page.captureScreenshot не вернул данные");

  const outputDir = process.env.SMOKE_OUT_DIR || os.tmpdir();
  fs.mkdirSync(outputDir, { recursive: true });
  screenshotPath = path.join(outputDir, `ut99web-smoke-${Date.now()}.png`);
  const buffer = Buffer.from(capture.data, "base64");
  fs.writeFileSync(screenshotPath, buffer);
  const size = validatePng(buffer, screenshotPath);

  console.log(`OK: ${screenshotPath} (${buffer.length} байт, ${size.width}x${size.height})`);
  console.log(`OK: ${loaded.starts} стартов, collision=${loaded.collision}, mode=${loaded.mode}`);
  console.log(`OK: lightmap=${loaded.lightmap}, bake=${loaded.bakeMs} ms`);
  console.log(`OK: pickups=${loaded.pickups}, meshes=${loaded.pickupMeshes}`);
  console.log(`OK: bots=${loaded.bots}, alive=${loaded.botsAlive}, shots=${loaded.botShots}, blocked=${loaded.botBlockedShots}`);
  console.log(`OK: ${cdp.requests.length} локальных запросов, ошибок JS нет`);
}

let exitCode = 0;
const hardTimeout = new Promise((_, reject) => {
  setTimeout(() => reject(new Error("общий таймаут 60 с")), TOTAL_TIMEOUT_MS);
});

try {
  await Promise.race([run(), hardTimeout]);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  if (cdp?.problems?.length) {
    for (const problem of cdp.problems) console.error(`  ${problem}`);
  }
  exitCode = 1;
} finally {
  await cleanup();
}

process.exit(exitCode);
