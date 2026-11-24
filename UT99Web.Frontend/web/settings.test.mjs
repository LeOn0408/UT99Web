import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  applyUrlOverrides,
  loadSettings,
  normalizeSettings,
  parseSettings,
  qualityPixelRatio,
  saveSettings
} from "../web/settings.js";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); }
  };
}

test("настройки по умолчанию валидны", () => {
  assert.deepEqual({ ...DEFAULT_SETTINGS }, {
    sensitivity: 1,
    quality: "medium",
    volume: 0.8,
    musicVolume: 0.35
  });
  assert.deepEqual(normalizeSettings(), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normalizeSettings(null), { ...DEFAULT_SETTINGS });
});

test("normalizeSettings ограничивает числа и качество", () => {
  assert.deepEqual(normalizeSettings({
    sensitivity: 99,
    quality: "ULTRA",
    volume: -3,
    musicVolume: 4
  }), { sensitivity: 3, quality: "medium", volume: 0, musicVolume: 1 });
  assert.equal(normalizeSettings({ sensitivity: 0 }).sensitivity, 0.2);
  assert.equal(normalizeSettings({ sensitivity: "abc" }).sensitivity, 1);
  assert.equal(normalizeSettings({ quality: "high" }).quality, "high");
});

test("битый JSON не бросает исключений", () => {
  assert.equal(parseSettings("{не json"), null);
  assert.equal(parseSettings("[]"), null);
  assert.equal(parseSettings("null"), null);
  assert.equal(parseSettings(""), null);
  assert.deepEqual(parseSettings('{"volume":0.5}'), { ...DEFAULT_SETTINGS, volume: 0.5 });
});

test("save/load используют одно хранилище и переживают мусор", () => {
  const storage = memoryStorage();
  assert.equal(saveSettings(storage, { sensitivity: 2.5, quality: "low", volume: 0.4, musicVolume: 0.1 }), true);
  assert.ok(storage.data.has(SETTINGS_KEY));
  assert.deepEqual(loadSettings(storage), { sensitivity: 2.5, quality: "low", volume: 0.4, musicVolume: 0.1 });

  const broken = memoryStorage({ [SETTINGS_KEY]: "{" });
  assert.deepEqual(loadSettings(broken), { ...DEFAULT_SETTINGS });
  assert.deepEqual(loadSettings(null), { ...DEFAULT_SETTINGS });

  const failing = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); }
  };
  assert.deepEqual(loadSettings(failing), { ...DEFAULT_SETTINGS });
  assert.equal(saveSettings(failing, DEFAULT_SETTINGS), false);
});

test("URL-параметры перекрывают сохранённые настройки", () => {
  const stored = { sensitivity: 1.5, quality: "high", volume: 0.8, musicVolume: 0.35 };
  const params = new URLSearchParams("volume=0.1&quality=low&sensitivity=0.5");
  assert.deepEqual(applyUrlOverrides(stored, params), {
    sensitivity: 0.5,
    quality: "low",
    volume: 0.1,
    musicVolume: 0.35
  });
  assert.deepEqual(applyUrlOverrides(stored, new URLSearchParams()), stored);
  assert.deepEqual(applyUrlOverrides(stored, null), stored);
  assert.equal(applyUrlOverrides(stored, new URLSearchParams("sensitivity=99")).sensitivity, 3);
  assert.equal(applyUrlOverrides(stored, new URLSearchParams("quality=???")).quality, "medium");
});

test("qualityPixelRatio не превышает devicePixelRatio", () => {
  assert.equal(qualityPixelRatio("low", 2), 0.75);
  assert.equal(qualityPixelRatio("medium", 2), 1);
  assert.equal(qualityPixelRatio("high", 2), 2);
  assert.equal(qualityPixelRatio("high", 1), 1);
  assert.equal(qualityPixelRatio("high", 1.25), 1.25);
  assert.equal(qualityPixelRatio("low", 1), 0.75);
  assert.equal(qualityPixelRatio("unknown", 3), 1);
  assert.equal(qualityPixelRatio("medium", 0), 1);
});
