#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const audioDir = path.join(root, "assets", "game", "Audio");
const manifestPath = path.join(audioDir, "audio-manifest.json");
const outputPath = path.join(audioDir, "music-web-manifest.json");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const force = process.argv.includes("--force");

function writeAtomic(file, content) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.rmSync(file, { force: true });
  fs.renameSync(temporary, file);
}

function relative(file) {
  return path.relative(audioDir, file).split(path.sep).join("/");
}

try {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`нет ${relative(manifestPath)}; сначала выполните npm run build:audio`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const entries = Object.entries(manifest.music ?? {});
  if (!entries.length) throw new Error("в audio-manifest.json нет музыки");

  const missing = entries
    .map(([key, entry]) => ({ key, entry, output: path.join(audioDir, entry.path.replace(/\.(it|xm|mod|s3m)$/i, ".ogg")) }))
    .filter(({ output }) => force || !fs.existsSync(output));

  if (missing.length) {
    const check = spawnSync(ffmpeg, ["-version"], { stdio: "ignore", windowsHide: true });
    if (check.error || check.status !== 0) {
      console.warn(`ffmpeg не найден (${ffmpeg}). Установите ffmpeg или задайте FFMPEG_PATH.`);
      console.warn("Музыка не сконвертирована; игра будет работать без музыки.");
      process.exit(0);
    } else {
      for (const { key, entry, output } of missing) {
        const input = path.join(audioDir, entry.path);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        const result = spawnSync(ffmpeg, [
          "-hide_banner",
          "-loglevel", "error",
          "-y",
          "-i", input,
          "-vn",
          "-c:a", "libvorbis",
          "-q:a", "4",
          output
        ], { encoding: "utf8", windowsHide: true });
        if (result.error || result.status !== 0) {
          const detail = (result.stderr ?? "").trim().split(/\r?\n/).slice(-3).join(" ");
          throw new Error(`${key}: ffmpeg завершился с кодом ${result.status ?? "?"}: ${detail}`);
        }
        console.log(`Конвертирован ${key} → ${relative(output)}`);
      }
    }
  }

  const tracks = {};
  for (const [key, entry] of entries) {
    const output = path.join(audioDir, entry.path.replace(/\.(it|xm|mod|s3m)$/i, ".ogg"));
    if (!fs.existsSync(output)) {
      console.warn(`Пропущен трек ${key}: нет ${relative(output)}`);
      continue;
    }
    const data = fs.readFileSync(output);
    if (data.subarray(0, 4).toString("ascii") !== "OggS") {
      throw new Error(`${key}: выходной файл не OGG`);
    }
    tracks[key] = {
      path: relative(output),
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      sourceFormat: entry.format,
      browserPlayable: true
    };
  }

  if (!Object.keys(tracks).length) {
    throw new Error("не удалось получить ни одного OGG-трека");
  }
  writeAtomic(outputPath, JSON.stringify({ version: 1, tracks }, null, 2));
  console.log(`Музыка: ${Object.keys(tracks).length} OGG, манифест ${relative(outputPath)} (${fs.statSync(outputPath).size} байт)`);
} catch (error) {
  fs.rmSync(`${outputPath}.tmp`, { force: true });
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
