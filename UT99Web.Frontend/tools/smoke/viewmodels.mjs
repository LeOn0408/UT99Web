#!/usr/bin/env node
// Smoke-проверка viewmodel: для каждого из 10 оружий переключает меш,
// считает bbox корпуса в NDC (рука, материал 0, исключена) и снимает
// скриншот 1280x720. Проверяет треугольники, кадры анимаций и отсутствие
// JS-ошибок. Скриншоты — в SMOKE_OUT_DIR или %TEMP%.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "../..");
const STATIC_PORT = 8138;
const TOTAL_TIMEOUT_MS = 90000;
const LOAD_TIMEOUT_MS = 45000;
const CHROME = process.env.CHROME_PATH
  || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const WEAPONS = [
  "Enforcer", "ShockRifle", "SniperRifle", "UT_FlakCannon", "PulseGun",
  "UT_Eightball", "minigun2", "ripper", "ut_biorifle", "WarheadLauncher"
];

let staticServer = null;
let chrome = null;
let cdp = null;
let profileDir = null;
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
      }, 30000);
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
    if (child.exitCode !== null) fail(`Chrome завершился с кодом ${child.exitCode}`);
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
    if (child.exitCode !== null) fail(`Chrome завершился с кодом ${child.exitCode}`);
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
  if (!fs.existsSync(CHROME)) fail(`Chrome не найден: ${CHROME}. Укажите CHROME_PATH.`);
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ut99web-vm-smoke-"));
  chrome = spawn(CHROME, [
    "--headless=new",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--window-size=1280,720",
    "--use-angle=d3d11",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    url
  ], { stdio: "ignore", windowsHide: true });
  chrome.on("error", (error) => {
    console.error(`FAIL: не удалось запустить Chrome: ${error.message}`);
    process.exit(1);
  });
}

const READY_EXPRESSION = `(() => {
  const s = window.__threeState;
  const info = document.getElementById("info");
  const text = info ? info.textContent || "" : "";
  return {
    ready: !!s && !!window.__viewmodel && text.length > 0
      && !/loading/i.test(text) && !/^ERROR/i.test(text),
    info: text
  };
})()`;

async function waitForViewer() {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression: READY_EXPRESSION,
      returnByValue: true
    });
    if (evaluation.exceptionDetails) {
      fail(`не удалось прочитать состояние вьюера: ${evaluation.exceptionDetails.text}`);
    }
    last = evaluation.result?.value ?? null;
    if (last?.info?.startsWith("ERROR")) fail(`вьюер сообщил об ошибке: ${last.info}`);
    if (last?.ready) return last;
    await sleep(250);
  }
  fail(`карта не загрузилась за ${LOAD_TIMEOUT_MS} мс; info: ${last?.info ?? "(нет данных)"}`);
}

const WEAPON_EXPRESSION = `(async (name) => {
  const vm = window.__viewmodel;
  const camera = window.__weaponCamera;
  if (!vm || !camera) return { error: "нет viewmodel или камеры" };
  const ok = vm.setWeapon(name);
  if (!ok) return { error: "меш не построен" };
  vm.update(1 / 60, { speed: 0, lookX: 0, lookY: 0 });
  const mesh = vm.mesh;
  const position = mesh.geometry.attributes.position;
  const data = window.__threeState.meshData.weaponMeshes[window.__threeState.meshData.weapons[name].mesh];
  const animations = Object.fromEntries(Object.entries(data.animations ?? {})
    .map(([key, value]) => [key, value.frames.length]));
  // Один кадр анимации огня, чтобы проверить, что кадры подключаются.
  vm.play("fire");
  vm.update(0.2, {});
  const box = vm.screenBox(camera);
  vm.update(10, {}); // вернуться в idle
  return {
    triangles: position.count / 3,
    animations,
    box
  };
})(${JSON.stringify("WEAPON_NAME")})`;

async function inspectWeapon(name) {
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: WEAPON_EXPRESSION.replace("WEAPON_NAME", name),
    returnByValue: true,
    awaitPromise: true
  });
  if (evaluation.exceptionDetails) {
    const text = evaluation.exceptionDetails.exception?.description
      || evaluation.exceptionDetails.text;
    fail(`${name}: ошибка evaluate: ${text}`);
  }
  return evaluation.result?.value ?? null;
}

function validateWeapon(name, result) {
  if (!result) fail(`${name}: нет результата`);
  if (result.error) fail(`${name}: ${result.error}`);
  if (!Number.isFinite(result.triangles) || result.triangles < 50) {
    fail(`${name}: подозрительно мало треугольников: ${result.triangles}`);
  }
  const animNames = Object.keys(result.animations ?? {});
  if (animNames.length && !result.animations.idle && !result.animations.select) {
    fail(`${name}: нет кадров idle/select`);
  }
  const box = result.box;
  if (!box) fail(`${name}: корпус не попадает в кадр (bbox пуст)`);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  if (!(width > 0.02 && height > 0.02)) {
    fail(`${name}: корпус слишком мал в NDC: ${width.toFixed(3)}x${height.toFixed(3)}`);
  }
  if (box.minX >= 1 || box.maxX <= -1 || box.minY >= 1 || box.maxY <= -1) {
    fail(`${name}: корпус полностью за экраном: [${box.minX.toFixed(2)}, ${box.maxX.toFixed(2)}]x[${box.minY.toFixed(2)}, ${box.maxY.toFixed(2)}]`);
  }
}

async function captureWeapon(name, outputDir) {
  const capture = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  if (!capture?.data) fail(`${name}: captureScreenshot не вернул данные`);
  const file = path.join(outputDir, `viewmodel-${name}.png`);
  fs.writeFileSync(file, Buffer.from(capture.data, "base64"));
  return file;
}

async function killChild(child) {
  if (!child || child.exitCode !== null) return;
  const done = new Promise((resolve) => child.once("exit", resolve));
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
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
  const baseUrl = `${await startStaticServer()}?walk=1&menu=0`;
  launchChrome(baseUrl);
  const port = await readDebugPort(chrome);
  const wsUrl = await waitForPage(port, chrome);
  cdp = new CdpClient(wsUrl);
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.navigate", { url: baseUrl });
  await waitForViewer();

  const outputDir = process.env.SMOKE_OUT_DIR || path.join(os.tmpdir(), `ut99web-viewmodels-${Date.now()}`);
  fs.mkdirSync(outputDir, { recursive: true });

  for (const name of WEAPONS) {
    const result = await inspectWeapon(name);
    const file = await captureWeapon(name, outputDir);
    validateWeapon(name, result);
    const box = result.box;
    console.log(
      `OK: ${name} — ${result.triangles} tris, anims ${JSON.stringify(result.animations)}, ` +
      `bbox NDC [${box.minX.toFixed(2)}..${box.maxX.toFixed(2)}]x[${box.minY.toFixed(2)}..${box.maxY.toFixed(2)}] → ${path.basename(file)}`
    );
  }
  if (cdp.problems.length) {
    fail(`ошибки страницы:\n${cdp.problems.map((item) => `  ${item}`).join("\n")}`);
  }
  console.log(`OK: ${WEAPONS.length} скриншотов в ${outputDir}, ошибок JS нет`);
}

let exitCode = 0;
const hardTimeout = new Promise((_, reject) => {
  setTimeout(() => reject(new Error(`общий таймаут ${TOTAL_TIMEOUT_MS / 1000} с`)), TOTAL_TIMEOUT_MS);
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
