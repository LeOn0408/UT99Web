import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readPackage } from "../src/package/package.mjs";
import {
  detectMusicFormat,
  parseWav,
  readMusicObject,
  readSoundObject
} from "../src/audio/audio.mjs";

const root = path.join(import.meta.dirname, "..", "..");
const gameDir = path.join(root, "assets", "game");

function makeWav({ bitsPerSample = 8, sampleRate = 11025, samples = 16, tag = 1, channels = 1 } = {}) {
  const channelsCount = channels;
  const blockAlign = channelsCount * (bitsPerSample / 8);
  const dataSize = samples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(tag, 20);
  buffer.writeUInt16LE(channelsCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < dataSize; index += 1) {
    buffer[44 + index] = bitsPerSample === 8 ? 128 : index % 256;
  }
  return buffer;
}

test("разбирает 8-битный PCM WAV", () => {
  const wav = parseWav(makeWav({ bitsPerSample: 8, sampleRate: 11025, samples: 2205 }));
  assert.equal(wav.tag, 1);
  assert.equal(wav.channels, 1);
  assert.equal(wav.sampleRate, 11025);
  assert.equal(wav.bitsPerSample, 8);
  assert.equal(wav.dataSize, 2205);
  assert.ok(Math.abs(wav.duration - 0.2) < 1e-9);
});

test("разбирает 16-битный PCM WAV", () => {
  const wav = parseWav(makeWav({ bitsPerSample: 16, sampleRate: 22050, samples: 22050 }));
  assert.equal(wav.bitsPerSample, 16);
  assert.equal(wav.dataSize, 44100);
  assert.ok(Math.abs(wav.duration - 1) < 1e-9);
});

test("отклоняет битый RIFF и не-PCM", () => {
  const broken = makeWav();
  broken.write("NOPE", 0, "ascii");
  assert.throws(() => parseWav(broken), /RIFF/);

  const compressed = makeWav({ tag: 2 });
  assert.throws(() => parseWav(compressed), /PCM/);

  const stereo = makeWav({ channels: 2 });
  assert.throws(() => parseWav(stereo), /моно/);
});

test("определяет IT и XM по сигнатуре", () => {
  const it = Buffer.alloc(64);
  it.write("IMPM", 0, "ascii");
  assert.equal(detectMusicFormat(it), "it");

  const xm = Buffer.alloc(128);
  xm.write("Extended Module: ", 0, "ascii");
  assert.equal(detectMusicFormat(xm), "xm");

  assert.equal(detectMusicFormat(Buffer.from("RIFF....WAVE")), null);
});

test("читает реальный Sound из BotPack.u", {
  skip: !fs.existsSync(path.join(gameDir, "System", "BotPack.u"))
}, () => {
  const pkg = readPackage(fs.readFileSync(path.join(gameDir, "System", "BotPack.u")));
  const item = pkg.exports.find((entry) => entry.className === "Sound");
  assert.ok(item, "в BotPack.u нет Sound");
  const { format, data } = readSoundObject(pkg, item);
  assert.equal(format, "WAV");
  assert.equal(data.subarray(0, 4).toString("ascii"), "RIFF");
  const wav = parseWav(data);
  assert.ok(wav.duration > 0);
});

test("читает реальный Music из Botmca9.umx", {
  skip: !fs.existsSync(path.join(gameDir, "Music", "Botmca9.umx"))
}, () => {
  const pkg = readPackage(fs.readFileSync(path.join(gameDir, "Music", "Botmca9.umx")));
  const item = pkg.exports.find((entry) => entry.className === "Music");
  assert.ok(item, "в Botmca9.umx нет Music");
  const { format, data } = readMusicObject(pkg, item);
  assert.equal(String(format).toLowerCase(), "it");
  assert.equal(detectMusicFormat(data), "it");
});

test("манифест согласован и содержит только относительные пути", {
  skip: !fs.existsSync(path.join(gameDir, "Audio", "audio-manifest.json"))
}, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(gameDir, "Audio", "audio-manifest.json"), "utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.counts.sounds, Object.keys(manifest.sounds).length);
  assert.equal(manifest.counts.music, Object.keys(manifest.music).length);
  assert.ok(manifest.counts.sounds > 1000);
  assert.ok(manifest.counts.music > 20);

  for (const [key, entry] of Object.entries(manifest.sounds)) {
    assert.ok(!path.isAbsolute(entry.path), `${key}: абсолютный путь`);
    assert.ok(!entry.path.includes(".."), `${key}: путь с ..`);
    assert.equal(entry.format, "wav");
    assert.equal(entry.codec, "pcm");
    assert.equal(entry.channels, 1);
    assert.ok([8, 16].includes(entry.bitsPerSample), `${key}: битность`);
    assert.ok(entry.duration > 0, `${key}: длительность`);
    assert.equal(entry.sha256.length, 64, `${key}: sha256`);
    assert.ok(fs.existsSync(path.join(gameDir, "Audio", entry.path)), `${key}: нет файла`);
  }

  for (const [key, entry] of Object.entries(manifest.music)) {
    assert.ok(!path.isAbsolute(entry.path), `${key}: абсолютный путь`);
    assert.ok(!entry.path.includes(".."), `${key}: путь с ..`);
    assert.ok(["it", "xm", "mod", "s3m"].includes(entry.format), `${key}: формат`);
    assert.equal(entry.browserPlayable, false, `${key}: browserPlayable`);
    assert.equal(entry.sha256.length, 64, `${key}: sha256`);
    assert.ok(fs.existsSync(path.join(gameDir, "Audio", entry.path)), `${key}: нет файла`);
  }
});
