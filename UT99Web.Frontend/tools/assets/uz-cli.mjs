#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { decompressUz } from "./uz.mjs";

const [input, outputDirectory] = process.argv.slice(2);
if (!input) {
  console.error("Использование: node tools/assets/uz-cli.mjs <файл.uz> [каталог]");
  process.exit(1);
}

try {
  const result = decompressUz(fs.readFileSync(path.resolve(input)));
  const directory = outputDirectory ? path.resolve(outputDirectory) : path.dirname(path.resolve(input));
  const target = path.join(directory, result.name || `${path.basename(input, ".uz")}.unr`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(target, result.data);
  console.log(`${input} → ${target} (${result.data.length} байт)`);
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
