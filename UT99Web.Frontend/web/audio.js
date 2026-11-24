import { resolveSoundKey } from "../engine/src/audio/events.mjs";

const AUDIO_BASE = "../assets/game/Audio/";
const MAX_VOICES = 8;
const SOUND_COOLDOWN_MS = 40;

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function encodePath(relative) {
  return String(relative)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function createAudio(options = {}) {
  const enabled = options.enabled !== false;
  const musicEnabled = options.musicEnabled !== false;
  const musicTrack = options.musicTrack ?? null;
  const masterVolume = clamp01(options.masterVolume ?? 0.8);
  const musicVolume = clamp01(options.musicVolume ?? 0.35);
  let masterLevel = masterVolume;

  let context = null;
  let masterGain = null;
  let musicGain = null;
  let baseUrl = null;
  let manifest = null;
  let musicManifest = null;
  let unlockPromise = null;
  let unlocked = false;
  let muted = false;
  let currentMusic = null;
  let musicToken = 0;

  const buffers = new Map();
  const pending = new Map();
  const musicBuffers = new Map();
  const lastPlayed = new Map();
  const activeSources = new Set();
  const warnings = new Set();

  function warnOnce(key, error) {
    if (warnings.has(key)) return;
    warnings.add(key);
    console.warn(`[audio] ${key}: ${error?.message ?? error}`);
  }

  function createContext() {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio не поддерживается");
    context = new AudioContextClass();
    masterGain = context.createGain();
    masterGain.gain.value = muted ? 0 : masterLevel;
    masterGain.connect(context.destination);
    musicGain = context.createGain();
    musicGain.gain.value = musicVolume;
    musicGain.connect(masterGain);
  }

  async function loadJson(name) {
    const response = await fetch(new URL(name, baseUrl), { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${name}`);
    return response.json();
  }

  function assetUrl(relative) {
    return new URL(encodePath(relative), baseUrl).href;
  }

  async function loadSound(key) {
    if (buffers.has(key)) return buffers.get(key);
    if (pending.has(key)) return pending.get(key);
    const entry = manifest?.sounds?.[key];
    if (!entry?.path) return null;
    const promise = (async () => {
      const response = await fetch(assetUrl(entry.path), { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${entry.path}`);
      const data = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(data.slice(0));
      buffers.set(key, buffer);
      return buffer;
    })();
    pending.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      warnOnce(`sound ${key}`, error);
      return null;
    } finally {
      pending.delete(key);
    }
  }

  async function play(event, soundOptions = {}) {
    if (!enabled) return false;
    if (!unlocked) {
      if (!unlockPromise) return false;
      const ready = await unlockPromise;
      if (!ready) return false;
    }
    if (!context || !manifest) return false;
    const key = resolveSoundKey(manifest, event);
    if (!key) return false;
    const now = performance.now();
    if (now - (lastPlayed.get(key) ?? -Infinity) < SOUND_COOLDOWN_MS) return false;
    if (activeSources.size >= MAX_VOICES) return false;
    const buffer = await loadSound(key);
    if (!buffer || !context) return false;
    lastPlayed.set(key, now);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.25, Math.min(4, Number(soundOptions.rate) || 1));
    const gain = context.createGain();
    gain.gain.value = clamp01(soundOptions.volume ?? 1);
    source.connect(gain);
    gain.connect(masterGain);
    activeSources.add(source);
    source.onended = () => {
      activeSources.delete(source);
      try { gain.disconnect(); } catch {}
    };
    try {
      source.start();
    } catch (error) {
      activeSources.delete(source);
      warnOnce(`start ${key}`, error);
      return false;
    }
    return true;
  }

  async function loadMusicManifest() {
    if (musicManifest) return;
    try {
      musicManifest = await loadJson("music-web-manifest.json");
    } catch {
      musicManifest = null;
    }
  }

  function findMusicEntry(track) {
    const name = String(track);
    const lower = name.toLowerCase();
    const match = (key, entry) => {
      const entryName = String(entry?.name ?? key.split(".").pop()).toLowerCase();
      return key.toLowerCase() === lower || key.toLowerCase().endsWith(`.${lower}`) || entryName === lower;
    };
    for (const [key, entry] of Object.entries(musicManifest?.tracks ?? {})) {
      if (match(key, entry)) return { key, ...entry };
    }
    for (const [key, entry] of Object.entries(manifest?.music ?? {})) {
      if (match(key, entry)) {
        return { key, path: String(entry.path).replace(/\.(it|xm|mod|s3m)$/i, ".ogg") };
      }
    }
    return null;
  }

  async function loadMusicBuffer(entry) {
    if (musicBuffers.has(entry.path)) return musicBuffers.get(entry.path);
    const response = await fetch(assetUrl(entry.path), { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${entry.path}`);
    const data = await response.arrayBuffer();
    const buffer = await context.decodeAudioData(data);
    musicBuffers.set(entry.path, buffer);
    return buffer;
  }

  function stopMusic(fade = 0.3) {
    musicToken += 1;
    if (!currentMusic) return;
    const { source, gain } = currentMusic;
    currentMusic = null;
    const now = context?.currentTime ?? 0;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fade);
    } catch {}
    setTimeout(() => {
      try { source.stop(); } catch {}
      try { gain.disconnect(); } catch {}
    }, Math.max(0, fade) * 1000 + 50);
  }

  async function playMusic(track) {
    if (!enabled || !musicEnabled || !context || !track) return false;
    await loadMusicManifest();
    const entry = findMusicEntry(track);
    if (!entry) {
      warnOnce(`music ${track}`, new Error("нет OGG-трека; выполните npm run build:music"));
      return false;
    }
    stopMusic(0.2);
    const token = musicToken;
    let buffer;
    try {
      buffer = await loadMusicBuffer(entry);
    } catch (error) {
      warnOnce(`music ${track}`, error);
      return false;
    }
    if (token !== musicToken || !context) return false;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(musicGain);
    currentMusic = { source, gain, key: entry.key ?? track };
    gain.gain.linearRampToValueAtTime(1, context.currentTime + 0.3);
    try {
      source.start();
    } catch (error) {
      currentMusic = null;
      warnOnce(`music start ${track}`, error);
      return false;
    }
    return true;
  }

  async function unlock() {
    if (!enabled) return false;
    if (unlockPromise) return unlockPromise;
    unlockPromise = (async () => {
      try {
        if (!context) createContext();
        baseUrl = new URL(AUDIO_BASE, window.location.href);
        try {
          await context.resume();
        } catch (error) {
          warnOnce("resume", error);
        }
        if (!manifest) {
          try {
            manifest = await loadJson("audio-manifest.json");
          } catch (error) {
            manifest = null;
            warnOnce("manifest", error);
          }
        }
        unlocked = Boolean(context);
        if (musicEnabled && musicTrack && manifest) {
          playMusic(musicTrack).catch((error) => warnOnce(`music ${musicTrack}`, error));
        }
        return unlocked;
      } catch (error) {
        warnOnce("unlock", error);
        return false;
      }
    })();
    return unlockPromise;
  }

  function setMasterVolume(value) {
    masterLevel = clamp01(value);
    if (masterGain) masterGain.gain.value = muted ? 0 : masterLevel;
    return masterLevel;
  }

  function setMusicVolume(value) {
    const volume = clamp01(value);
    if (musicGain) musicGain.gain.value = volume;
    return volume;
  }

  function toggleMute() {
    muted = !muted;
    if (masterGain) masterGain.gain.value = muted ? 0 : masterLevel;
    return muted;
  }

  function status() {
    return {
      enabled,
      unlocked,
      muted,
      contextState: context?.state ?? null,
      manifestLoaded: Boolean(manifest),
      musicManifestLoaded: Boolean(musicManifest),
      music: currentMusic?.key ?? null,
      bufferedSounds: buffers.size
    };
  }

  return {
    unlock,
    play,
    playMusic,
    stopMusic,
    setMasterVolume,
    setMusicVolume,
    toggleMute,
    status
  };
}
