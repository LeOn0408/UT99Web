#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readPackage } from "../../engine/src/package/package.mjs";
import { readSoundObject } from "../../engine/src/audio/audio.mjs";

const [input, soundName, output] = process.argv.slice(2);
if (!input || !soundName || !output) {
  console.error("Использование: node tools/assets/extract-sound.mjs <пакет> <SoundName> <файл.wav>");
  process.exit(1);
}

try {
  const pkg = readPackage(fs.readFileSync(path.resolve(input)));
  const sound = pkg.exports.find((item) => item.className === "Sound" && item.objectName === soundName);
  if (!sound) throw new Error(`Звук ${soundName} не найден`);

  const { format, data } = readSoundObject(pkg, sound);
  if (format !== "WAV") throw new Error(`Формат ${format} пока не поддерживается`);

  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), data);
  console.log(`${input}:${soundName} → ${output} (${data.length} байт)`);
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
