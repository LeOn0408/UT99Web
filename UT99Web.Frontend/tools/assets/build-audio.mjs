#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readPackage } from "../../engine/src/package/package.mjs";
import {
  detectMusicFormat,
  parseWav,
  readMusicObject,
  readSoundObject
} from "../../engine/src/audio/audio.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const gameDir = path.join(root, "assets", "game");
const audioDir = path.join(gameDir, "Audio");
const soundsRoot = path.join(gameDir, "Sounds");
const systemRoot = path.join(gameDir, "System");
const musicRoot = path.join(gameDir, "Music");
const manifestPath = path.join(audioDir, "audio-manifest.json");

function safeSegment(value, label) {
  const text = String(value ?? "");
  if (!text || text === "." || text === ".." || /[\\/:*?"<>|\x00-\x1f]/.test(text)) {
    throw new Error(`Недопустимое имя ${label}: ${JSON.stringify(text)}`);
  }
  return text;
}

function packageFiles(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith(extension))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(directory, name));
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.rmSync(file, { force: true });
  fs.renameSync(temporary, file);
}

function hash(data) {
  return createHash("sha256").update(data).digest("hex");
}

function audioRelative(file) {
  return path.relative(audioDir, file).split(path.sep).join("/");
}

const sounds = new Map();
const music = new Map();
const bitsCounts = new Map();
const musicFormats = new Map();
const packages = [];
const seenSoundData = new Map();
const seenMusicData = new Map();
const soundNameUse = new Map();
const musicNameUse = new Map();
let duplicatesSkipped = 0;

try {
  const soundPackagePaths = [
    ...packageFiles(soundsRoot, ".uax"),
    ...packageFiles(systemRoot, ".u")
  ];

  for (const file of soundPackagePaths) {
    const packageName = safeSegment(path.basename(file, path.extname(file)), "пакета");
    const pkg = readPackage(fs.readFileSync(file));
    const items = pkg.exports.filter((item) => item.className === "Sound");
    if (!items.length) continue;
    packages.push(packageName);
    for (const item of items) {
      const objectName = safeSegment(item.objectName, `Sound в ${packageName}`);
      try {
        const { format, data } = readSoundObject(pkg, item);
        if (String(format).toUpperCase() !== "WAV") {
          throw new Error(`неподдерживаемый формат ${format}`);
        }
        const wav = parseWav(data);
        const digest = hash(data);
        const groupKey = `${packageName}.${objectName}`;
        const hashes = seenSoundData.get(groupKey) ?? new Set();
        if (hashes.has(digest)) {
          duplicatesSkipped += 1;
          console.warn(`Пропущен дубликат ${groupKey} с теми же данными`);
          continue;
        }
        hashes.add(digest);
        seenSoundData.set(groupKey, hashes);
        const occurrence = (soundNameUse.get(groupKey) ?? 0) + 1;
        soundNameUse.set(groupKey, occurrence);
        const suffix = occurrence === 1 ? "" : `#${item.index}`;
        const key = `${groupKey}${suffix}`;
        if (sounds.has(key)) throw new Error(`Дублирующийся звук ${key}`);
        const target = path.join(audioDir, "Sounds", packageName, `${objectName}${suffix}.wav`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
        bitsCounts.set(wav.bitsPerSample, (bitsCounts.get(wav.bitsPerSample) ?? 0) + 1);
        sounds.set(key, {
          package: packageName,
          name: objectName,
          exportIndex: item.index,
          path: audioRelative(target),
          format: "wav",
          codec: "pcm",
          sampleRate: wav.sampleRate,
          channels: wav.channels,
          bitsPerSample: wav.bitsPerSample,
          duration: Number(wav.duration.toFixed(3)),
          bytes: data.length,
          sha256: digest
        });
      } catch (error) {
        throw new Error(`${packageName}.${objectName}: ${error.message}`);
      }
    }
  }

  for (const file of packageFiles(musicRoot, ".umx")) {
    const packageName = safeSegment(path.basename(file, path.extname(file)), "пакета");
    const pkg = readPackage(fs.readFileSync(file));
    const items = pkg.exports.filter((item) => item.className === "Music");
    if (!items.length) continue;
    packages.push(packageName);
    for (const item of items) {
      const objectName = safeSegment(item.objectName, `Music в ${packageName}`);
      try {
        const { format, data } = readMusicObject(pkg, item);
        const detected = detectMusicFormat(data);
        if (!detected) throw new Error(`неизвестная сигнатура трека (пакетный формат ${format})`);
        const digest = hash(data);
        const groupKey = `${packageName}.${objectName}`;
        const hashes = seenMusicData.get(groupKey) ?? new Set();
        if (hashes.has(digest)) {
          duplicatesSkipped += 1;
          console.warn(`Пропущен дубликат ${groupKey} с теми же данными`);
          continue;
        }
        hashes.add(digest);
        seenMusicData.set(groupKey, hashes);
        const occurrence = (musicNameUse.get(groupKey) ?? 0) + 1;
        musicNameUse.set(groupKey, occurrence);
        const suffix = occurrence === 1 ? "" : `#${item.index}`;
        const key = `${groupKey}${suffix}`;
        if (music.has(key)) throw new Error(`Дублирующийся трек ${key}`);
        const target = path.join(audioDir, "Music", packageName, `${objectName}${suffix}.${detected}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
        musicFormats.set(detected, (musicFormats.get(detected) ?? 0) + 1);
        music.set(key, {
          package: packageName,
          name: objectName,
          exportIndex: item.index,
          path: audioRelative(target),
          format: detected,
          bytes: data.length,
          sha256: digest,
          browserPlayable: false
        });
      } catch (error) {
        throw new Error(`${packageName}.${objectName}: ${error.message}`);
      }
    }
  }

  const sortedSounds = Object.fromEntries([...sounds].sort(([a], [b]) => a.localeCompare(b)));
  const sortedMusic = Object.fromEntries([...music].sort(([a], [b]) => a.localeCompare(b)));
  const manifest = {
    version: 1,
    counts: { sounds: sounds.size, music: music.size },
    sounds: sortedSounds,
    music: sortedMusic
  };
  writeAtomic(manifestPath, JSON.stringify(manifest, null, 2));

  const bitsText = [...bitsCounts].sort((a, b) => a[0] - b[0]).map(([bits, count]) => `${bits}-bit: ${count}`).join(", ");
  const musicText = [...musicFormats].sort((a, b) => a[0].localeCompare(b[0])).map(([format, count]) => `${format}: ${count}`).join(", ");
  console.log(`Пакетов: ${new Set(packages).size}`);
  console.log(`Звуки: ${sounds.size} (wav/pcm, ${bitsText || "нет"})`);
  console.log(`Музыка: ${music.size} (${musicText || "нет"})`);
  if (duplicatesSkipped) console.log(`Пропущено одинаковых дубликатов: ${duplicatesSkipped}`);
  console.log(`Манифест: ${path.relative(root, manifestPath)} (${fs.statSync(manifestPath).size} байт)`);
} catch (error) {
  fs.rmSync(`${manifestPath}.tmp`, { force: true });
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
