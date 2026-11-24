import * as THREE from "./vendor/three.module.js";
import { decompressUz } from "../tools/assets/uz.mjs";
import { readPackage } from "../engine/src/package/package.mjs";
import { loadLevelModel } from "../engine/src/level/model.mjs";
import { readLevelLights } from "../engine/src/level/lights.mjs";
import { readActors, readPlayerStarts } from "../engine/src/level/actors.mjs";
import { readLevelInfo } from "../engine/src/level/level-info.mjs";
import { weaponFireEvent } from "../engine/src/audio/events.mjs";
import { createAudio } from "./audio.js";
import { createTextureCatalog, buildTexturedMesh } from "../engine/src/texture/catalog.mjs";
import { buildCollisionMesh, createCollisionWorld, resolveSphereCollisions, raycast } from "../engine/src/level/collision.mjs";
import { BOT_DAMAGE, BOT_EYE, BOT_RADIUS, BOT_RANGE, BOT_SPEED, absorbDamage, hasLineOfSight, moveBotHorizontal, pickDetourTarget, updateBotStuck } from "../engine/src/level/bots.mjs";
import { buildZoneLookup, isLiquidZone } from "../engine/src/level/zones.mjs";
import { bakeLightmapAtlas } from "../engine/src/level/lightmap.mjs";
import { MAPS, DEFAULT_MAP, selectedMap } from "./maps.js";
import {
  addDeath,
  addEntry,
  addFrag,
  createScoreboard,
  findWinner,
  formatFragProgress,
  normalizeFragLimit,
  sortedEntries
} from "../engine/src/match/score.mjs";
import { createViewmodel } from "./viewmodel.js";
import {
  applyUrlOverrides,
  loadSettings,
  normalizeSettings,
  qualityPixelRatio,
  saveSettings,
  SETTINGS_KEY
} from "./settings.js";

const canvas = document.getElementById("view");
const info = document.getElementById("info");
const params = new URLSearchParams(window.location.search);
function settingsStorage() {
  try { return window.localStorage; } catch { return null; }
}
const settings = applyUrlOverrides(loadSettings(settingsStorage(), SETTINGS_KEY), params);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(qualityPixelRatio(settings.quality, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080c);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 100000);
const weaponScene = new THREE.Scene();
const weaponCamera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 1, 5000);
weaponCamera.position.set(0, 0, 0);
weaponScene.add(new THREE.AmbientLight(0xffffff, 0.55));
const weaponPointLight = new THREE.PointLight(0xfff1d8, 2.0, 2500);
weaponPointLight.position.set(80, 120, 60);
weaponScene.add(weaponPointLight);
const weaponKeyLight = new THREE.DirectionalLight(0xfff1d8, 0.9);
weaponKeyLight.position.set(-200, 300, 100);
weaponKeyLight.target.position.set(0, 0, -300);
weaponScene.add(weaponKeyLight.target);
weaponScene.add(weaponKeyLight);

// --- Настройки ---------------------------------------------------------
let settingsOpen = false;

function applyRenderQuality() {
  renderer.setPixelRatio(qualityPixelRatio(settings.quality, window.devicePixelRatio || 1));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  weaponCamera.aspect = window.innerWidth / window.innerHeight;
  weaponCamera.updateProjectionMatrix();
}

function applySettingsToAudio() {
  state.audio?.setMasterVolume(settings.volume);
  state.audio?.setMusicVolume(settings.musicVolume);
}

function syncSettingsUi() {
  const sensitivity = document.getElementById("settings-sensitivity");
  const sensitivityValue = document.getElementById("settings-sensitivity-value");
  const quality = document.getElementById("settings-quality");
  const volume = document.getElementById("settings-volume");
  const volumeValue = document.getElementById("settings-volume-value");
  const musicVolume = document.getElementById("settings-music-volume");
  const musicVolumeValue = document.getElementById("settings-music-volume-value");
  if (sensitivity) sensitivity.value = String(settings.sensitivity);
  if (sensitivityValue) sensitivityValue.textContent = settings.sensitivity.toFixed(2);
  if (quality) quality.value = settings.quality;
  if (volume) volume.value = String(settings.volume);
  if (volumeValue) volumeValue.textContent = `${Math.round(settings.volume * 100)}%`;
  if (musicVolume) musicVolume.value = String(settings.musicVolume);
  if (musicVolumeValue) musicVolumeValue.textContent = `${Math.round(settings.musicVolume * 100)}%`;
  updateFullscreenLabel();
}

function updateFullscreenLabel() {
  const button = document.getElementById("settings-fullscreen");
  if (button) button.textContent = document.fullscreenElement ? "EXIT FULLSCREEN" : "FULLSCREEN";
}

function updateSetting(partial) {
  Object.assign(settings, normalizeSettings({ ...settings, ...partial }));
  saveSettings(settingsStorage(), settings, SETTINGS_KEY);
  applySettingsToAudio();
  syncSettingsUi();
}

function openSettings() {
  const panel = document.getElementById("settings");
  if (!panel) return;
  settingsOpen = true;
  syncSettingsUi();
  panel.classList.add("is-on");
}

function closeSettings() {
  settingsOpen = false;
  document.getElementById("settings")?.classList.remove("is-on");
}

function toggleFullscreen() {
  try {
    const request = document.fullscreenElement
      ? document.exitFullscreen?.()
      : document.documentElement.requestFullscreen?.();
    if (request?.catch) request.catch(() => {});
  } catch {}
}

function setupSettings() {
  const panel = document.getElementById("settings");
  if (!panel) return;
  const sensitivity = document.getElementById("settings-sensitivity");
  const quality = document.getElementById("settings-quality");
  const volume = document.getElementById("settings-volume");
  const musicVolume = document.getElementById("settings-music-volume");
  sensitivity?.addEventListener("input", () => updateSetting({ sensitivity: sensitivity.value }));
  quality?.addEventListener("change", () => {
    updateSetting({ quality: quality.value });
    applyRenderQuality();
  });
  volume?.addEventListener("input", () => updateSetting({ volume: volume.value }));
  musicVolume?.addEventListener("input", () => updateSetting({ musicVolume: musicVolume.value }));
  document.getElementById("settings-close")?.addEventListener("click", closeSettings);
  document.getElementById("settings-fullscreen")?.addEventListener("click", toggleFullscreen);
  document.getElementById("pause-settings")?.addEventListener("click", openSettings);
  document.getElementById("menu-settings")?.addEventListener("click", openSettings);
  document.addEventListener("fullscreenchange", updateFullscreenLabel);
  syncSettingsUi();
}

function setupMenu() {
  const menu = document.getElementById("menu");
  const list = document.getElementById("menu-map-list");
  const title = document.getElementById("menu-map-title");
  const info = document.getElementById("menu-map-info");
  const start = document.getElementById("menu-start");
  if (!menu || !list || !start) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("menu") === "0" || params.get("walk") === "1" || params.get("fly") === "1") {
    menu.classList.remove("is-on");
    return;
  }
  menu.classList.add("is-on");
  const ids = Object.keys(MAPS).sort((a, b) => a.localeCompare(b));
  const requested = params.get("map");
  const stored = window.localStorage.getItem("ut99web.map");
  let selected = requested && MAPS[requested] ? requested : stored && MAPS[stored] ? stored : DEFAULT_MAP;
  let mode = "walk";
  const buttons = new Map();
  const update = () => {
    const map = MAPS[selected] ?? MAPS[DEFAULT_MAP];
    title.textContent = map.title;
    info.textContent = mode === "walk" ? "Deathmatch / explore" : mode === "fly" ? "Free flight" : "Orbit camera";
    for (const [id, button] of buttons) button.classList.toggle("is-active", id === selected);
    for (const button of document.querySelectorAll(".menu-mode")) button.classList.toggle("is-active", button.dataset.mode === mode);
  };
  for (const id of ids) {
    const button = document.createElement("button");
    button.className = "menu-map";
    button.type = "button";
    button.innerHTML = `<span>${MAPS[id].title}</span><small>${MAPS[id].mode}</small>`;
    button.addEventListener("click", () => {
      selected = id;
      window.localStorage.setItem("ut99web.map", id);
      update();
    });
    buttons.set(id, button);
    list.appendChild(button);
  }
  for (const button of document.querySelectorAll(".menu-mode")) {
    button.addEventListener("click", () => { mode = button.dataset.mode ?? "walk"; update(); });
  }
  start.addEventListener("click", () => {
    window.localStorage.setItem("ut99web.map", selected);
    const next = new URLSearchParams();
    next.set("map", selected);
    next.set("menu", "0");
    if (mode === "walk") next.set("walk", "1");
    if (mode === "fly") next.set("fly", "1");
    window.location.search = next.toString();
  });
  update();
}

const mapInfo = selectedMap();
const state = {
  settings,
  mode: "orbit",
  yaw: 0,
  pitch: 0,
  distance: 1800,
  target: new THREE.Vector3(),
  keys: new Set(),
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  onGround: false,
  radius: 17,
  eye: 64,
  walk: Boolean(params.get("walk") === "1"),
  collision: null,
  starts: [],
  zones: null,
  lightmapEnabled: false,
  lightmapWidth: 0,
  lightmapHeight: 0,
  lightmapBakeMs: 0,
  current: "Enforcer",
  weapons: ["Enforcer", "ShockRifle", "SniperRifle", "UT_FlakCannon", "PulseGun", "UT_Eightball"],
  ammo: { Enforcer: 30, ShockRifle: 20, SniperRifle: 8, UT_FlakCannon: 10, PulseGun: 60, UT_Eightball: 6 },
  health: 100,
  armor: 0,
  dead: false,
  paused: false,
  matchOver: false,
  matchWinner: null,
  score: createScoreboard({ limit: normalizeFragLimit(params.get("fraglimit")) }),
  cooldown: 0,
  meshData: null,
  atlas: null,
  tracers: [],
  bots: [],
  pickups: [],
  pickupMeshes: 0,
  pickupTime: 0,
  pickupMaterial: null,
  botShots: 0,
  botBlockedShots: 0,
  lookX: 0,
  lookY: 0,
  audio: null,
  song: null
};

const PICKUP_SCALE = 0.3;
const PICKUP_RADIUS = 55;
const pickupGeometryCache = new Map();

const STARTING_AMMO = {
  ShockRifle: 20,
  SniperRifle: 8,
  UT_Eightball: 6,
  UT_FlakCannon: 10,
  PulseGun: 60,
  minigun2: 50,
  ripper: 20,
  ut_biorifle: 20,
  WarheadLauncher: 6
};

// Явные таблицы классов вместо регулярных выражений: имя класса в нижнем
// регистре → эффект при подборе.
const PICKUP_TABLE = {
  healthvial: { kind: "health", amount: 5, label: "Health Vial" },
  medbox: { kind: "health", amount: 25, label: "MedBox" },
  thighpads: { kind: "armor", amount: 50, label: "Thigh Pads" },
  armor2: { kind: "armor", amount: 50, label: "Body Armor" },
  ut_shieldbelt: { kind: "armor", amount: 100, label: "Shield Belt" },
  shockcore: { kind: "ammo", weapon: "ShockRifle", amount: 10, label: "Shock Core" },
  pammo: { kind: "ammo", weapon: "PulseGun", amount: 25, label: "Pulse Ammo" },
  rocketpack: { kind: "ammo", weapon: "UT_Eightball", amount: 6, label: "Rocket Pack" },
  flakammo: { kind: "ammo", weapon: "UT_FlakCannon", amount: 10, label: "Flak Ammo" },
  bioammo: { kind: "ammo", weapon: "ut_biorifle", amount: 20, label: "Bio Ammo" },
  miniammo: { kind: "ammo", weapon: "minigun2", amount: 50, label: "Minigun Ammo" },
  bladehopper: { kind: "ammo", weapon: "ripper", amount: 20, label: "Blade Hopper" },
  bulletbox: { kind: "ammo", weapon: "SniperRifle", amount: 10, label: "Bullet Box" },
  shockrifle: { kind: "weapon", weapon: "ShockRifle" },
  sniperrifle: { kind: "weapon", weapon: "SniperRifle" },
  ut_eightball: { kind: "weapon", weapon: "UT_Eightball" },
  ut_flakcannon: { kind: "weapon", weapon: "UT_FlakCannon" },
  pulsegun: { kind: "weapon", weapon: "PulseGun" },
  minigun2: { kind: "weapon", weapon: "minigun2" },
  ripper: { kind: "weapon", weapon: "ripper" },
  ut_biorifle: { kind: "weapon", weapon: "ut_biorifle" },
  warheadlauncher: { kind: "weapon", weapon: "WarheadLauncher" },
  ut_jumpboots: { kind: "note", text: "Jump Boots — not implemented" },
  udamage: { kind: "note", text: "UDamage — not implemented" }
};

function setInfo(text) { info.textContent = text; }
function toYUp(point) { return [point.x, point.z, -point.y]; }

function playSound(event, options) {
  state.audio?.play(event, options);
}

function setupAudioUnlock() {
  const audio = state.audio;
  const hint = document.getElementById("audio-hint");
  if (!audio) return;
  if (audio.status().enabled === false) {
    hint?.remove();
    return;
  }
  let requested = false;
  const unlock = () => {
    if (requested) return;
    requested = true;
    audio.unlock().then(() => hint?.remove()).catch(() => hint?.remove());
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}
function textureFromImage(image) {
  const data = new Uint8Array(image.data);
  const texture = new THREE.DataTexture(data, image.width || 1, image.height || 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function textureFromLightmap(atlas) {
  const texture = new THREE.DataTexture(new Uint8Array(atlas.atlas), atlas.width, atlas.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.channel = 1;
  texture.needsUpdate = true;
  return texture;
}

async function loadTexturePackage(name) {
  const response = await fetch(`../assets/game/Textures/${encodeURIComponent(name)}.utx`);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${name}.utx`);
  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  setInfo(`loading ${mapInfo.title}?`);
  const response = await fetch(`../assets/game/Maps/${encodeURIComponent(mapInfo.file)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${mapInfo.file}`);
  const pkg = readPackage(decompressUz(new Uint8Array(await response.arrayBuffer())).data);
  const model = loadLevelModel(pkg);
  const lights = readLevelLights(pkg);
  const lightmapEnabled = params.get("lightmap") !== "0";
  const shadows = params.get("shadows") !== "0";
  let lightmapAtlas = null;
  let lightmapTexture = null;
  if (lightmapEnabled) {
    const started = performance.now();
    lightmapAtlas = bakeLightmapAtlas(model, lights, { shadows });
    lightmapTexture = textureFromLightmap(lightmapAtlas);
    state.lightmapBakeMs = Math.round(performance.now() - started);
    console.info(`lightmap ${lightmapAtlas.width}x${lightmapAtlas.height}: ${state.lightmapBakeMs} ms`);
  }
  state.lightmapEnabled = Boolean(lightmapAtlas);
  state.lightmapWidth = lightmapAtlas?.width ?? 0;
  state.lightmapHeight = lightmapAtlas?.height ?? 0;
  state.starts = readPlayerStarts(pkg);
  const actors = readActors(pkg);
  const levelInfo = readLevelInfo(pkg);
  state.song = levelInfo.song;
  const audioParam = params.get("audio");
  const musicParam = params.get("music");
  const audioEnabled = audioParam !== "0";
  const musicEnabled = audioEnabled && musicParam !== "0" && musicParam !== "off";
  const musicTrack = musicEnabled
    ? (musicParam && musicParam !== "1" ? musicParam : state.song)
    : null;
  state.audio = createAudio({
    enabled: audioEnabled,
    musicEnabled,
    musicTrack,
    masterVolume: settings.volume,
    musicVolume: settings.musicVolume
  });
  applySettingsToAudio();
  const catalog = await createTextureCatalog(pkg, model, { loadPackage: loadTexturePackage });
  const zones = buildZoneLookup(pkg, model);
  const textureName = (ref) => {
    const entry = ref > 0 ? pkg.exports[ref - 1] : ref < 0 ? pkg.imports[-ref - 1] : null;
    return entry?.objectName ?? "";
  };
  const liquidNode = (node) => {
    const surface = model.surfaces[node.surface];
    if (surface && /water|slime|lava|acid|jgreen/i.test(textureName(surface.texture))) return true;
    return [node.leaf[0], node.leaf[1]].some((leafIndex) => {
      const leaf = model.leaves[leafIndex];
      return leaf && isLiquidZone(zones.zoneNames[leaf.zone]);
    });
  };
  const meshData = buildTexturedMesh(model, catalog, lights, { shadows, lightmapAtlas, nodeFilter: (node) => !liquidNode(node) });

  const positions = new Float32Array(meshData.positions.length);
  const normals = new Float32Array(meshData.positions.length);
  const colors = new Float32Array(meshData.positions.length);
  const uvs = new Float32Array(meshData.uvs.length);
  const lmuvs = new Float32Array(meshData.lmuvs.length);
  for (let i = 0; i < meshData.positions.length; i += 3) {
    positions[i] = meshData.positions[i];
    positions[i + 1] = meshData.positions[i + 2];
    positions[i + 2] = -meshData.positions[i + 1];
    normals[i] = meshData.normals[i];
    normals[i + 1] = meshData.normals[i + 2];
    normals[i + 2] = -meshData.normals[i + 1];
    colors[i] = meshData.colors[i];
    colors[i + 1] = meshData.colors[i + 1];
    colors[i + 2] = meshData.colors[i + 2];
  }
  uvs.set(meshData.uvs);
  lmuvs.set(meshData.lmuvs);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("uv1", new THREE.BufferAttribute(lmuvs, 2));
  const materials = [];
  const materialIndex = new Map();
  for (const group of meshData.groups) {
    let index = materialIndex.get(group.ref);
    if (index === undefined) {
      const image = catalog.textures.get(group.ref) ?? catalog.checker;
      const material = new THREE.MeshBasicMaterial({
        map: textureFromImage(image),
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.35,
        ...(lightmapTexture ? { lightMap: lightmapTexture, lightMapIntensity: Math.PI } : {})
      });
      index = materials.length;
      materialIndex.set(group.ref, index);
      materials.push(material);
    }
    geometry.addGroup(group.start, group.count, index);
  }
  const map = new THREE.Mesh(geometry, materials);
  map.frustumCulled = false;
  scene.add(map);
  const liquidData = buildTexturedMesh(model, catalog, lights, { shadows, lightmapAtlas, nodeFilter: liquidNode, keepFlagged: true });
  if (liquidData.positions.length) {
    const lp = new Float32Array(liquidData.positions.length);
    const lu = new Float32Array(liquidData.uvs.length);
    const llm = new Float32Array(liquidData.lmuvs.length);
    for (let i = 0; i < liquidData.positions.length; i += 3) {
      lp[i] = liquidData.positions[i];
      lp[i + 1] = liquidData.positions[i + 2];
      lp[i + 2] = -liquidData.positions[i + 1];
    }
    lu.set(liquidData.uvs);
    llm.set(liquidData.lmuvs);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(lp, 3));
    lg.setAttribute("uv", new THREE.BufferAttribute(lu, 2));
    lg.setAttribute("uv1", new THREE.BufferAttribute(llm, 2));
    const liquidMaterials = [];
    const liquidIndex = new Map();
    for (const group of liquidData.groups) {
      let index = liquidIndex.get(group.ref);
      if (index === undefined) {
        const image = catalog.textures.get(group.ref) ?? catalog.checker;
        index = liquidMaterials.length;
        liquidIndex.set(group.ref, index);
        liquidMaterials.push(new THREE.MeshBasicMaterial({ map: textureFromImage(image), side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false, alphaTest: 0.05, ...(lightmapTexture ? { lightMap: lightmapTexture, lightMapIntensity: Math.PI } : {}) }));
      }
      lg.addGroup(group.start, group.count, index);
    }
    const liquidMesh = new THREE.Mesh(lg, liquidMaterials);
    liquidMesh.frustumCulled = false;
    scene.add(liquidMesh);
  }
  scene.add(camera);

  const bounds = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  state.target.copy(center);
  state.distance = Math.max(size.x, size.z) * 1.1;
  state.collision = createCollisionWorld(buildCollisionMesh(model));
  state.zones = zones;
  try {
    const meshResponse = await fetch("../assets/game/Scripts/pickup-meshes.json?v=44");
    state.meshData = meshResponse.ok ? await meshResponse.json() : null;
    if (state.meshData?.atlas?.file) {
      const image = new Image();
      image.src = `../assets/game/Scripts/${state.meshData.atlas.file}?v=44`;
      await image.decode();
      state.atlas = new THREE.Texture(image);
      state.atlas.colorSpace = THREE.SRGBColorSpace;
      // UV в бандле заданы от верхнего левого угла PNG, поэтому переворот
      // изображения при загрузке нужно отключить.
      state.atlas.flipY = false;
      state.atlas.needsUpdate = true;
      // Для viewmodel мипмапы атласа дают мыло на крупном оружии.
      state.weaponAtlas = state.atlas.clone();
      state.weaponAtlas.minFilter = THREE.LinearFilter;
      state.weaponAtlas.magFilter = THREE.LinearFilter;
      state.weaponAtlas.generateMipmaps = false;
      state.weaponAtlas.needsUpdate = true;
    }
  } catch {}
  if (state.meshData && state.meshData.version !== EXPECTED_BUNDLE_VERSION) {
    console.error(
      `pickup-meshes.json устарел (version ${state.meshData.version ?? "нет"}, нужна ${EXPECTED_BUNDLE_VERSION}). Запустите: npm run build:meshes`
    );
    state.meshData = null;
  }
  if (state.meshData) {
    viewmodel = createViewmodel({
      scene: weaponScene,
      meshes: state.meshData.weaponMeshes,
      weapons: state.meshData.weapons,
      atlas: state.weaponAtlas ?? state.atlas
    });
    window.__viewmodel = viewmodel;
    window.__weaponCamera = weaponCamera;
    window.__threeState = state;
  }
  buildPickups(actors);
  buildBots();
  buildViewmodel(state.current);
  updateHud();

  const start = state.starts[0] ? toYUp(state.starts[0].location) : [center.x, center.y, center.z];
  const startAngle = state.starts[0]?.rotation?.yaw ? (state.starts[0].rotation.yaw / 65536) * Math.PI * 2 : 0;
  state.position.set(start[0], start[1] + state.radius, start[2]);
  state.yaw = params.get("yaw") !== null ? Number(params.get("yaw")) : Math.PI / 2 + startAngle;
  state.pitch = params.get("pitch") !== null ? Number(params.get("pitch")) : 0;
  state.mode = state.walk ? "walk" : "orbit";
  setInfo(`${mapInfo.title} · ${meshData.triangles} tris · ${liquidData.triangles} liquid · ${catalog.textures.size} tex · ${lightmapAtlas ? `lm ${lightmapAtlas.width}x${lightmapAtlas.height}` : "lm off"}`);
  bindInput();
  setupAudioUnlock();
  requestAnimationFrame(frame);
}

function pickupInfo(className) {
  return PICKUP_TABLE[String(className).toLowerCase()] ?? null;
}

function pickupMaterial() {
  if (state.pickupMaterial) return state.pickupMaterial;
  if (!state.atlas) return null;
  state.pickupMaterial = new THREE.MeshBasicMaterial({
    map: state.atlas,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.35
  });
  return state.pickupMaterial;
}

function pickupGeometry(name) {
  if (pickupGeometryCache.has(name)) return pickupGeometryCache.get(name);
  const data = state.meshData?.meshes?.[name];
  if (!data?.positions?.length) {
    pickupGeometryCache.set(name, null);
    return null;
  }
  const source = data.positions;
  const positions = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 3) {
    positions[i] = source[i];
    positions[i + 1] = source[i + 2];
    positions[i + 2] = -source[i + 1];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(data.uvs), 2));
  pickupGeometryCache.set(name, geometry);
  return geometry;
}

function pickupMeshName(className) {
  const byClass = state.meshData?.byClass;
  if (!byClass) return null;
  if (byClass[className]) return byClass[className];
  const lower = String(className).toLowerCase();
  for (const [name, mesh] of Object.entries(byClass)) {
    if (name.toLowerCase() === lower) return mesh;
  }
  return null;
}

function fallbackColor(info) {
  if (info.kind === "health") return 0x4fd06a;
  if (info.kind === "armor") return 0x66aaff;
  if (info.kind === "ammo") return 0xf2cc63;
  if (info.kind === "note") return 0xff8844;
  return 0xf2cc63;
}

function buildPickups(actors) {
  state.pickups = [];
  state.pickupMeshes = 0;
  const material = pickupMaterial();
  const meshNames = new Map();
  actors.forEach((actor, index) => {
    if (!actor.location) return;
    const info = pickupInfo(actor.className);
    if (!info) return;
    const meshName = pickupMeshName(actor.className);
    const geometry = meshName ? pickupGeometry(meshName) : null;
    let mesh;
    if (geometry && material) {
      mesh = new THREE.Mesh(geometry, material);
      state.pickupMeshes += 1;
      if (meshName) meshNames.set(actor.className, meshName);
    } else {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(14, 14, 14),
        new THREE.MeshBasicMaterial({ color: fallbackColor(info) })
      );
    }
    const point = toYUp(actor.location);
    mesh.position.set(point[0], point[1], point[2]);
    const drawScale = Number(actor.drawScale) || 1;
    if (geometry) mesh.scale.setScalar(PICKUP_SCALE * drawScale);
    scene.add(mesh);
    state.pickups.push({
      mesh,
      info,
      className: actor.className,
      collected: false,
      phase: (index * 0.7) % (Math.PI * 2)
    });
  });
  if (meshNames.size) {
    console.info(`pickups: ${state.pickups.length}, meshes: ${state.pickupMeshes}`);
    console.info([...meshNames].map(([cls, mesh]) => `${cls} → ${mesh}`).join(", "));
  }
}

let pickupNoteTimer = 0;
function showPickupNote(text) {
  const element = document.getElementById("pickup-note");
  if (!element) return;
  element.textContent = text;
  element.style.opacity = "1";
  clearTimeout(pickupNoteTimer);
  pickupNoteTimer = setTimeout(() => { element.style.opacity = "0"; }, 1600);
}

function collectPickup(pickup) {
  pickup.collected = true;
  scene.remove(pickup.mesh);
  if (!pickup.mesh.geometry?.attributes?.uv) pickup.mesh.material?.dispose();
  const info = pickup.info;
  if (info.kind === "health") {
    state.health = Math.min(100, state.health + info.amount);
    playSound("pickup.health");
    showPickupNote(`+${info.amount} health`);
  } else if (info.kind === "armor") {
    state.armor = Math.min(100, state.armor + info.amount);
    playSound("pickup.armor");
    showPickupNote(`+${info.amount} armor`);
  } else if (info.kind === "ammo") {
    state.ammo[info.weapon] = (state.ammo[info.weapon] ?? 0) + info.amount;
    playSound("pickup.ammo");
    showPickupNote(`${info.label}: +${info.amount}`);
  } else if (info.kind === "weapon") {
    const weapon = info.weapon;
    const already = state.weapons.includes(weapon);
    if (!already) {
      state.weapons.push(weapon);
      if (state.ammo[weapon] === undefined) state.ammo[weapon] = STARTING_AMMO[weapon] ?? 0;
      state.current = weapon;
      if (viewmodel?.setWeapon(weapon)) viewmodel.play("select");
    } else {
      state.ammo[weapon] = (state.ammo[weapon] ?? 0) + (STARTING_AMMO[weapon] ?? 0);
    }
    playSound("pickup.weapon");
    showPickupNote(already ? `${weapon}: ammo` : `Picked up ${weapon}`);
  } else if (info.kind === "note") {
    showPickupNote(info.text);
  }
  updateHud();
}

function updatePickups(delta) {
  state.pickupTime += delta;
  for (const pickup of state.pickups) {
    if (pickup.collected) continue;
    const mesh = pickup.mesh;
    if (mesh.geometry?.attributes?.uv) mesh.rotation.y = pickup.phase + state.pickupTime * 1.4;
    const dx = mesh.position.x - state.position.x;
    const dy = mesh.position.y - state.position.y;
    const dz = mesh.position.z - state.position.z;
    if (Math.hypot(dx, dy, dz) < PICKUP_RADIUS) collectPickup(pickup);
  }
}

function writeBotFrame(target, source) {
  for (let i = 0; i < source.length; i += 3) {
    target[i] = source[i];
    target[i + 1] = source[i + 2];
    target[i + 2] = -source[i + 1];
  }
}

function buildBots() {
  if (!state.meshData?.bot || !state.atlas) return;
  const bot = state.meshData.bot;
  const frame = bot.animations?.idle?.frames?.[0] ?? bot.frames?.[0];
  if (!frame || !bot.uvs) return;
  const positions = new Float32Array(frame.length);
  writeBotFrame(positions, frame);
  for (let index = 1; index < Math.min(5, state.starts.length); index += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions.slice(), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(bot.uvs), 2));
    const material = new THREE.MeshBasicMaterial({ map: state.atlas, side: THREE.DoubleSide, transparent: true, alphaTest: 0.35 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    const start = toYUp(state.starts[index].location);
    const center = new THREE.Vector3(start[0], start[1] + BOT_RADIUS, start[2]);
    mesh.position.set(center.x, center.y - BOT_RADIUS, center.z);
    scene.add(mesh);
    const id = `bot${index}`;
    const name = `Bot ${index}`;
    state.bots.push({
      id,
      name,
      index,
      mesh,
      geometry,
      center,
      velocityY: 0,
      health: 100,
      alive: true,
      respawn: 0,
      frame: 0,
      frameTime: 0,
      stuckTime: 0,
      detourTime: 0,
      lastMoved: 0,
      fire: 1 + Math.random(),
      animations: bot.animations ?? { idle: { frames: [frame] }, run: { frames: [frame] } }
    });
    addEntry(state.score, id, name);
  }
  console.info(`bots: ${state.bots.length}`, state.bots.map((bot) => bot.center.toArray().map((value) => Math.round(value))));
}

function raySphere(origin, direction, center, radius) {
  const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z;
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const d = b * b - c;
  if (d < 0) return null;
  const t = -b - Math.sqrt(d);
  return t >= 0 ? t : null;
}

function resolveBotCenter(center, radius = BOT_RADIUS) {
  const position = [center.x, center.y, center.z];
  resolveSphereCollisions(state.collision, position, [0, 0, 0], radius);
  center.set(position[0], position[1], position[2]);
}

function separateBots() {
  const minimum = BOT_RADIUS * 2;
  for (let firstIndex = 0; firstIndex < state.bots.length; firstIndex += 1) {
    const first = state.bots[firstIndex];
    if (!first.alive) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < state.bots.length; secondIndex += 1) {
      const second = state.bots[secondIndex];
      if (!second.alive) continue;
      const dx = second.center.x - first.center.x;
      const dz = second.center.z - first.center.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= minimum) continue;
      const nx = distance < 1e-3 ? 1 : dx / distance;
      const nz = distance < 1e-3 ? 0 : dz / distance;
      const push = (minimum - distance) / 2;
      first.center.x -= nx * push;
      first.center.z -= nz * push;
      second.center.x += nx * push;
      second.center.z += nz * push;
      resolveBotCenter(first.center);
      resolveBotCenter(second.center);
    }
  }
}

function respawnBot(bot, randomize = false) {
  if (!state.starts.length) return;
  const count = state.starts.length;
  // randomize — при застревании: стартовая точка может быть бракованной,
  // повторять её бессмысленно.
  const startIndex = randomize && count > 1
    ? 1 + Math.floor(Math.random() * (count - 1))
    : count > 1 ? 1 + (bot.index % (count - 1)) : 0;
  const start = toYUp(state.starts[startIndex].location);
  bot.center.set(start[0], start[1] + BOT_RADIUS, start[2]);
  bot.mesh.position.set(bot.center.x, bot.center.y - BOT_RADIUS, bot.center.z);
  bot.health = 100;
  bot.alive = true;
  bot.velocityY = 0;
  bot.fire = 1 + Math.random();
  scene.add(bot.mesh);
}

function updateBots(delta) {
  if (state.mode !== "walk" || state.dead || state.matchOver) return;
  for (const bot of state.bots) {
    if (!bot.alive) {
      bot.respawn -= delta;
      if (bot.respawn <= 0) respawnBot(bot);
      continue;
    }
    const center = bot.center;
    let dx = state.position.x - center.x;
    let dz = state.position.z - center.z;
    let distance = Math.hypot(dx, dz) || 1;
    if (distance > 90) {
      const position = [center.x, center.y, center.z];
      // Застрявший бот идёт в обход: секунду движется к боковой цели.
      if (updateBotStuck(bot, bot.lastMoved ?? BOT_SPEED * delta, BOT_SPEED, delta)) {
        bot.detour = pickDetourTarget(position, [state.position.x, state.position.y, state.position.z]);
        bot.detourTime = 0.8;
      }
      // Точка спауна может оказаться внутри геометрии: если бот не
      // двигается даже с обходами больше ~5 с, переспауниваем его.
      if (bot.stuckTime > 5) {
        respawnBot(bot, true);
        bot.stuckTime = 0;
        bot.detourTime = 0;
        bot.lastMoved = 0;
        continue;
      }
      if (bot.detourTime > 0) bot.detourTime -= delta;
      const target = bot.detourTime > 0 && bot.detour
        ? bot.detour
        : [state.position.x, state.position.y, state.position.z];
      moveBotHorizontal(state.collision, position, target, BOT_SPEED, delta, BOT_RADIUS);
      bot.lastMoved = Math.hypot(position[0] - center.x, position[2] - center.z);
      center.set(position[0], position[1], position[2]);
    } else {
      bot.lastMoved = 0;
      bot.stuckTime = 0;
      bot.detourTime = 0;
    }
    bot.velocityY -= 950 * delta;
    center.y += bot.velocityY * delta;
    const ground = raycast(state.collision, [center.x, center.y + BOT_EYE, center.z], [0, -1, 0], 3000);
    if (ground) {
      const feet = center.y - BOT_RADIUS;
      const gap = feet - ground.point[1];
      if (gap < 0 || (gap <= 24 && bot.velocityY <= 0)) {
        center.y = ground.point[1] + BOT_RADIUS;
        bot.velocityY = 0;
      }
    }
    dx = state.position.x - center.x;
    dz = state.position.z - center.z;
    distance = Math.hypot(dx, dz) || 1;
    bot.mesh.rotation.y = Math.atan2(dx, dz);
    const animation = distance > 110 ? bot.animations.run : bot.animations.idle;
    const frames = animation?.frames;
    if (frames?.length) {
      bot.frameTime += delta * (animation.rate ?? 10);
      const index = Math.floor(bot.frameTime) % frames.length;
      const source = frames[index];
      const target = bot.geometry.attributes.position.array;
      writeBotFrame(target, source);
      bot.geometry.attributes.position.needsUpdate = true;
    }
    bot.fire -= delta;
    if (bot.fire <= 0 && distance < BOT_RANGE) {
      const eye = [center.x, center.y + BOT_EYE, center.z];
      const target = [state.position.x, state.position.y + state.eye, state.position.z];
      if (!hasLineOfSight(state.collision, eye, target)) {
        state.botBlockedShots += 1;
        bot.fire = 0.3 + Math.random() * 0.5;
        // Бот рядом, но без линии видимости (другой этаж, карман у
        // стены): стоял бы вечно. После нескольких секунд простоя —
        // переспаун.
        bot.blockedTime = (bot.blockedTime ?? 0) + bot.fire;
        if (bot.blockedTime > 4) {
          respawnBot(bot, true);
          bot.blockedTime = 0;
          bot.stuckTime = 0;
          bot.detourTime = 0;
          bot.lastMoved = 0;
        }
      } else {
        bot.blockedTime = 0;
        bot.fire = 0.8 + Math.random() * 0.8;
        state.botShots += 1;
        const result = absorbDamage(state.health, state.armor, BOT_DAMAGE);
        state.health = result.health;
        state.armor = result.armor;
        playSound("bot.fire");
        playSound("player.hurt");
        spawnTracer(eye, target, 0xff8855);
        updateHud();
        if (state.health <= 0) {
          state.health = 0;
          showDeath(bot);
          break;
        }
      }
    }
  }
  separateBots();
  for (const bot of state.bots) {
    if (!bot.alive) continue;
    bot.mesh.position.set(bot.center.x, bot.center.y - BOT_RADIUS, bot.center.z);
  }
}

function showDeath(killer = null) {
  if (state.matchOver) return;
  state.dead = true;
  playSound("player.death");
  addDeath(state.score, "player");
  if (killer) addFrag(state.score, killer.id);
  updateHud();
  const winner = findWinner(state.score);
  if (winner) {
    endMatch(winner);
    return;
  }
  document.getElementById("death-stats").textContent = `Health ${Math.max(0, Math.round(state.health))} · Score ${formatFragProgress(state.score)}`;
  document.getElementById("death").classList.add("is-on");
  if (document.exitPointerLock) document.exitPointerLock();
}

function renderMatchScoreboard() {
  const container = document.getElementById("match-score");
  if (!container) return;
  container.textContent = "";
  const head = document.createElement("div");
  head.className = "score-row score-head";
  for (const text of ["#", "Player", "Frags", "Deaths"]) {
    const cell = document.createElement("span");
    cell.textContent = text;
    head.appendChild(cell);
  }
  container.appendChild(head);
  sortedEntries(state.score).forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = `score-row${entry.id === "player" ? " is-player" : ""}`;
    for (const text of [String(index + 1), entry.id === "player" ? "You" : entry.name, String(entry.frags), String(entry.deaths)]) {
      const cell = document.createElement("span");
      cell.textContent = text;
      row.appendChild(cell);
    }
    container.appendChild(row);
  });
}

function endMatch(winner) {
  if (!winner || state.matchOver) return;
  state.matchOver = true;
  state.matchWinner = winner.id;
  state.paused = false;
  state.keys.clear();
  state.velocity.set(0, 0, 0);
  document.getElementById("pause")?.classList.remove("is-on");
  document.getElementById("death")?.classList.remove("is-on");
  closeSettings();
  const victory = winner.id === "player";
  const title = document.getElementById("match-end-title");
  const subtitle = document.getElementById("match-end-sub");
  if (title) title.textContent = victory ? "VICTORY" : "DEFEAT";
  if (subtitle) subtitle.textContent = victory
    ? "You reached the frag limit"
    : `${winner.name} reached the frag limit`;
  renderMatchScoreboard();
  document.getElementById("match-end")?.classList.add("is-on");
  updateHud();
  if (document.exitPointerLock) document.exitPointerLock();
}

function setPaused(value) {
  if (value && (state.dead || state.matchOver)) return;
  state.paused = Boolean(value);
  const overlay = document.getElementById("pause");
  if (overlay) overlay.classList.toggle("is-on", state.paused);
  if (state.paused) {
    state.keys.clear();
    state.velocity.set(0, 0, 0);
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
  } else if (state.mode === "walk" && !state.dead) {
    try {
      const request = canvas.requestPointerLock?.();
      if (request?.catch) request.catch(() => {});
    } catch {}
  }
}

function restartMatch() {
  window.location.reload();
}

function goToMainMenu() {
  const url = new URL(window.location.href);
  url.searchParams.delete("walk");
  url.searchParams.delete("fly");
  url.searchParams.delete("menu");
  window.location.href = url.toString();
}

function respawn() {
  if (state.matchOver) return;
  state.dead = false;
  state.health = 100;
  state.armor = 0;
  playSound("player.respawn");
  const start = state.starts[0] ? toYUp(state.starts[0].location) : [0, 0, 0];
  state.position.set(start[0], start[1] + state.radius, start[2]);
  state.velocity.set(0, 0, 0);
  document.getElementById("death").classList.remove("is-on");
  updateHud();
}

const WEAPON_SHORT = {
  Enforcer: "ENFORCER",
  ShockRifle: "ASMD",
  SniperRifle: "RIFLE",
  UT_FlakCannon: "FLAK",
  PulseGun: "PULSE",
  UT_Eightball: "ROCKET",
  minigun2: "MINIGUN",
  ripper: "RIPPER",
  ut_biorifle: "BIO",
  WarheadLauncher: "WARHEAD"
};

function renderWeaponBar() {
  const bar = document.getElementById("hud-weapons");
  if (!bar) return;
  bar.textContent = "";
  for (let index = 0; index < 10; index += 1) {
    const weapon = state.weapons[index] ?? null;
    const slot = document.createElement("div");
    slot.className = `hud-slot${weapon === state.current ? " is-active" : ""}${weapon ? "" : " is-empty"}`;
    const key = document.createElement("span");
    key.className = "key";
    key.textContent = String((index + 1) % 10);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = weapon ? (WEAPON_SHORT[weapon] ?? weapon) : "";
    slot.append(key, name);
    bar.appendChild(slot);
  }
}

function updateHud() {
  const health = document.getElementById("hud-health");
  const armor = document.getElementById("hud-armor");
  const ammo = document.getElementById("hud-ammo");
  const weapon = document.getElementById("hud-weapon");
  const frags = document.getElementById("hud-frags");
  const deaths = document.getElementById("hud-deaths");
  const rankElement = document.getElementById("hud-rank");
  const player = state.score.entries.find((entry) => entry.id === "player");
  const rank = sortedEntries(state.score).findIndex((entry) => entry.id === "player") + 1;
  if (health) health.textContent = String(Math.max(0, Math.round(state.health)));
  if (armor) armor.textContent = String(Math.max(0, Math.round(state.armor)));
  if (ammo) ammo.textContent = String(state.ammo[state.current] ?? 0);
  if (weapon) weapon.textContent = state.current;
  if (frags) frags.textContent = `${formatFragProgress(state.score)} frags`;
  if (deaths) deaths.textContent = `${player?.deaths ?? 0} deaths`;
  if (rankElement) {
    const suffix = rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th";
    rankElement.textContent = `${rank}${suffix}`;
  }
  renderWeaponBar();
}

// Версия бандла pickup-meshes.json: при несовпадении нужен
// `npm run build:meshes`, иначе viewmodel не строится.
const EXPECTED_BUNDLE_VERSION = 45;

// Viewmodel живёт в отдельном модуле: здесь только переключение оружия,
// проигрывание анимаций и update в кадре.
let viewmodel = null;

function buildViewmodel(name) {
  viewmodel?.setWeapon(name);
}

function cycleWeapon(direction) {
  const index = state.weapons.indexOf(state.current);
  state.current = state.weapons[(index + direction + state.weapons.length) % state.weapons.length];
  playSound("weapon.select");
  if (viewmodel?.setWeapon(state.current)) viewmodel.play("select");
  updateHud();
}

function spawnTracer(from, to, color) {
  const start = Array.isArray(from) ? new THREE.Vector3(from[0], from[1], from[2]) : from;
  const end = Array.isArray(to) ? new THREE.Vector3(to[0], to[1], to[2]) : to;
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineBasicMaterial({ color });
  const line = new THREE.Line(geometry, material);
  scene.add(line);
  state.tracers.push({ line, life: 0.12 });
  return line;
}

function fireWeapon() {
  if (state.mode !== "walk" || state.dead || state.matchOver || state.cooldown > 0) return;
  const ammo = state.ammo[state.current] ?? 0;
  if (ammo <= 0) {
    playSound("weapon.empty");
    return;
  }
  state.ammo[state.current] = ammo - 1;
  state.cooldown = 0.2;
  playSound(weaponFireEvent(state.current));
  viewmodel?.play("fire");
  const origin = camera.position.clone();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  let distance = 4000;
  let fragged = false;
  const wall = raycast(state.collision, [origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z], 12000);
  if (wall) distance = wall.distance;
  for (const bot of state.bots) {
    if (!bot.alive) continue;
    const center = bot.mesh.position.clone(); center.y += 40;
    const hit = raySphere(origin, direction, center, 28);
    if (hit !== null && hit < distance) {
      distance = hit;
      bot.health -= 17;
      if (bot.health <= 0) {
        bot.alive = false;
        bot.respawn = 3;
        scene.remove(bot.mesh);
        playSound("bot.death");
        addFrag(state.score, "player");
        addDeath(state.score, bot.id);
        fragged = true;
      } else {
        playSound("bot.hit");
      }
    }
  }
  const end = origin.clone().addScaledVector(direction, distance);
  spawnTracer(origin, end, 0xffdd55);
  updateHud();
  if (fragged) {
    const winner = findWinner(state.score);
    if (winner) endMatch(winner);
    else showPickupNote(`FRAG! ${formatFragProgress(state.score)}`);
  }
}

function bindInput() {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    state.audio?.unlock();
    if (state.mode === "walk") {
      if (state.matchOver) return;
      if (state.dead) { respawn(); return; }
      canvas.requestPointerLock?.();
      fireWeapon();
    } else {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
    }
  });
  window.addEventListener("mouseup", () => { dragging = false; });
  window.addEventListener("mousemove", (event) => {
    const sensitivity = settings.sensitivity;
    if (document.pointerLockElement === canvas) {
      state.yaw -= event.movementX * 0.0022 * sensitivity;
      state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - event.movementY * 0.0022 * sensitivity));
      state.lookX += event.movementX;
      state.lookY += event.movementY;
      return;
    }
    if (!dragging || state.mode === "walk") return;
    state.yaw -= (event.clientX - lastX) * 0.006 * sensitivity;
    state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch - (event.clientY - lastY) * 0.006 * sensitivity));
    lastX = event.clientX;
    lastY = event.clientY;
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (state.mode === "walk") cycleWeapon(event.deltaY > 0 ? 1 : -1);
    else if (state.mode === "orbit") state.distance = Math.max(80, state.distance * (event.deltaY > 0 ? 1.12 : 0.89));
  }, { passive: false });
  window.addEventListener("keydown", (event) => {
    state.audio?.unlock();
    const menuOpen = document.getElementById("menu")?.classList.contains("is-on");
    if (settingsOpen) {
      if (event.code === "Escape") {
        event.preventDefault();
        closeSettings();
      }
      return;
    }
    if (event.code === "KeyM" && !event.target?.matches?.("input, textarea, select")) {
      state.audio?.toggleMute();
      return;
    }
    if (state.matchOver) return;
    if (!menuOpen && event.code === "KeyF") {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
    if (!menuOpen && (event.code === "Escape" || event.code === "KeyP")) {
      if (state.dead) return;
      event.preventDefault();
      setPaused(!state.paused);
      return;
    }
    if (state.paused) return;
    state.keys.add(event.code);
    if (/^Digit[1-6]$/.test(event.code)) {
      const index = Number(event.code.slice(5)) - 1;
      if (state.weapons[index]) {
        state.current = state.weapons[index];
        playSound("weapon.select");
        if (viewmodel?.setWeapon(state.current)) viewmodel.play("select");
        updateHud();
      }
    }
    if (event.code === "KeyV") state.mode = "walk";
    if (event.code === "KeyO") state.mode = "orbit";
    if (["Space", "ControlLeft"].includes(event.code)) event.preventDefault();
  });
  window.addEventListener("keyup", (event) => state.keys.delete(event.code));
  window.addEventListener("blur", () => state.keys.clear());
  document.addEventListener("pointerlockchange", () => {
    if (state.mode !== "walk" || state.dead || state.paused || state.matchOver) return;
    if (document.pointerLockElement !== canvas) setPaused(true);
  });
  const resumeButton = document.getElementById("pause-resume");
  const restartButton = document.getElementById("pause-restart");
  const menuButton = document.getElementById("pause-menu");
  resumeButton?.addEventListener("click", () => setPaused(false));
  restartButton?.addEventListener("click", restartMatch);
  menuButton?.addEventListener("click", goToMainMenu);
  document.getElementById("match-rematch")?.addEventListener("click", restartMatch);
  document.getElementById("match-menu")?.addEventListener("click", goToMainMenu);
  window.addEventListener("resize", () => {
    applyRenderQuality();
  });
}

function updateWalk(delta) {
  if (state.dead) { state.velocity.set(0, 0, 0); return; }
  const wasOnGround = state.onGround;
  const preFall = state.velocity.y;
  const zone = state.zones?.at(state.position.x, -state.position.z, state.position.y)?.zone;
  const liquid = isLiquidZone(zone);
  const damagingLiquid = liquid && /slime|lava|acid/i.test(zone?.name ?? "");
  if (damagingLiquid) { state.health = Math.max(0, state.health - 12 * delta); updateHud(); }
  const speed = (state.keys.has("ShiftLeft") ? 420 : 240) * (liquid ? 0.5 : 1);
  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const move = new THREE.Vector3();
  if (state.keys.has("KeyW")) move.add(forward);
  if (state.keys.has("KeyS")) move.sub(forward);
  if (state.keys.has("KeyD")) move.sub(right);
  if (state.keys.has("KeyA")) move.add(right);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
  state.velocity.x = move.x;
  state.velocity.z = move.z;
  state.velocity.y -= (liquid ? 180 : 950) * delta;
  if (liquid && state.keys.has("Space")) state.velocity.y = Math.max(state.velocity.y, 200);
  else if (state.keys.has("Space") && state.onGround) { state.velocity.y = 330; state.onGround = false; playSound("player.jump"); }
  const position = [state.position.x, state.position.y - state.radius, state.position.z];
  const velocity = [state.velocity.x, state.velocity.y, state.velocity.z];
  for (let step = 0; step < 4; step++) {
    position[0] += velocity[0] * delta / 4;
    position[1] += velocity[1] * delta / 4;
    position[2] += velocity[2] * delta / 4;
    if (resolveSphereCollisions(state.collision, position, velocity, state.radius)) state.onGround = true;
  }
  state.position.set(position[0], position[1] + state.radius, position[2]);
  state.velocity.set(velocity[0], velocity[1], velocity[2]);
  if (!wasOnGround && state.onGround && preFall < -80) playSound("player.land");
  if (state.position.y < -3000) {
    const start = state.starts[0] ? toYUp(state.starts[0].location) : [0, 0, 0];
    state.position.set(start[0], start[1] + 40, start[2]);
    state.velocity.set(0, 0, 0);
  }
}

function frame(now) {
  const delta = Math.min((now - (frame.last || now)) / 1000, 0.05);
  frame.last = now;
  if (state.paused) {
    const zone = state.zones?.at(state.position.x, -state.position.z, state.position.y)?.zone?.name ?? "no zone";
    document.getElementById("pause-info").textContent = `X ${state.position.x.toFixed(1)} / Y ${state.position.y.toFixed(1)} / Z ${state.position.z.toFixed(1)} / ${zone}`;
  } else if (!state.matchOver) {
  state.cooldown = Math.max(0, state.cooldown - delta);
  for (let i = state.tracers.length - 1; i >= 0; i -= 1) {
    state.tracers[i].life -= delta;
    if (state.tracers[i].life <= 0) { scene.remove(state.tracers[i].line); state.tracers[i].line.geometry.dispose(); state.tracers[i].line.material.dispose(); state.tracers.splice(i, 1); }
  }
  updateBots(delta);
  updatePickups(delta);
  }
  if (state.mode === "walk") {
    if (!state.paused && !state.matchOver) updateWalk(delta);
    camera.position.set(state.position.x, state.position.y + state.eye, state.position.z);
    const cos = Math.cos(state.pitch);
    const dir = new THREE.Vector3(Math.sin(state.yaw) * cos, Math.sin(state.pitch), Math.cos(state.yaw) * cos);
    camera.lookAt(camera.position.clone().add(dir));
  } else {
    const eye = new THREE.Vector3(
      state.target.x + Math.sin(state.yaw) * Math.cos(state.pitch) * state.distance,
      state.target.y + Math.sin(state.pitch) * state.distance,
      state.target.z + Math.cos(state.yaw) * Math.cos(state.pitch) * state.distance
    );
    camera.position.copy(eye);
    camera.lookAt(state.target);
  }
  viewmodel?.update(delta, {
    speed: state.paused || state.dead ? 0 : Math.hypot(state.velocity.x, state.velocity.z),
    lookX: state.lookX,
    lookY: state.lookY
  });
  state.lookX = 0;
  state.lookY = 0;
  renderer.render(scene, camera);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(weaponScene, weaponCamera);
  renderer.autoClear = true;
  requestAnimationFrame(frame);
}

setupSettings();
setupMenu();
main().catch((error) => {
  setInfo(`ERROR: ${error.message}`);
  console.error(error);
});
