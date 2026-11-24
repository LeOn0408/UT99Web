// Настройки вьюера: чистые функции без DOM, чтобы их можно было
// проверять в node --test. Хранение — localStorage вызывающего кода.

export const SETTINGS_KEY = "ut99web.settings.v1";

export const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 1,
  quality: "medium",
  volume: 0.8,
  musicVolume: 0.35
});

export const QUALITY_LEVELS = Object.freeze(["low", "medium", "high"]);

const QUALITY_PIXEL_RATIOS = Object.freeze({
  low: 0.75,
  medium: 1,
  high: 2
});

const LIMITS = Object.freeze({
  sensitivity: { min: 0.2, max: 3, fallback: DEFAULT_SETTINGS.sensitivity },
  volume: { min: 0, max: 1, fallback: DEFAULT_SETTINGS.volume },
  musicVolume: { min: 0, max: 1, fallback: DEFAULT_SETTINGS.musicVolume }
});

function clampNumber(value, { min, max, fallback }) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function normalizeQuality(value) {
  const quality = String(value ?? "").trim().toLowerCase();
  return QUALITY_LEVELS.includes(quality) ? quality : DEFAULT_SETTINGS.quality;
}

export function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    sensitivity: clampNumber(source.sensitivity, LIMITS.sensitivity),
    quality: normalizeQuality(source.quality),
    volume: clampNumber(source.volume, LIMITS.volume),
    musicVolume: clampNumber(source.musicVolume, LIMITS.musicVolume)
  };
}

export function parseSettings(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return normalizeSettings(parsed);
  } catch {
    return null;
  }
}

export function loadSettings(storage, key = SETTINGS_KEY) {
  if (!storage || typeof storage.getItem !== "function") return { ...DEFAULT_SETTINGS };
  try {
    return parseSettings(storage.getItem(key)) ?? { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage, settings, key = SETTINGS_KEY) {
  const normalized = normalizeSettings(settings);
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem(key, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

// Отладочные параметры URL перекрывают сохранённые настройки, но
// отсутствующие параметры не затирают значения.
export function applyUrlOverrides(settings, params) {
  const result = normalizeSettings(settings);
  if (!params || typeof params.get !== "function") return result;
  const overrides = {
    sensitivity: params.get("sensitivity"),
    quality: params.get("quality"),
    volume: params.get("volume"),
    musicVolume: params.get("musicVolume")
  };
  if (overrides.sensitivity !== null) result.sensitivity = clampNumber(overrides.sensitivity, LIMITS.sensitivity);
  if (overrides.quality !== null) result.quality = normalizeQuality(overrides.quality);
  if (overrides.volume !== null) result.volume = clampNumber(overrides.volume, LIMITS.volume);
  if (overrides.musicVolume !== null) result.musicVolume = clampNumber(overrides.musicVolume, LIMITS.musicVolume);
  return result;
}

export function qualityPixelRatio(quality, devicePixelRatio = 1) {
  const base = QUALITY_PIXEL_RATIOS[normalizeQuality(quality)] ?? QUALITY_PIXEL_RATIOS.medium;
  const device = Number(devicePixelRatio);
  const limit = Number.isFinite(device) && device > 0 ? Math.max(0.5, device) : 1;
  return Math.max(0.5, Math.min(limit, base));
}
