#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readPackage } from "../../engine/src/package/package.mjs";
import { readMusicObject } from "../../engine/src/audio/audio.mjs";

const [input, outputDirectory] = process.argv.slice(2);
if (!input) {
  console.error("Использование: node tools/assets/extract-umx.mjs <файл.umx> [каталог]");
  process.exit(1);
}

try {
  const pkg = readPackage(fs.readFileSync(path.resolve(input)));
  const music = pkg.exports.find((item) => item.className === "Music");
  if (!music) throw new Error("В пакете нет Music-объекта");

  const { format, data } = readMusicObject(pkg, music);
  const extension = String(format ?? "mod").toLowerCase();

  const directory = outputDirectory ? path.resolve(outputDirectory) : path.dirname(path.resolve(input));
  const target = path.join(directory, `${path.basename(input, path.extname(input))}.${extension}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(target, data);
  console.log(`${input} → ${target} (${extension}, ${data.length} байт)`);
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
