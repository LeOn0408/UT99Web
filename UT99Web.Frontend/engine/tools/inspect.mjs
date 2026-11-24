#!/usr/bin/env node
import path from "node:path";
import { readPackageSummary } from "../src/package/package-reader.mjs";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Использование: node engine/tools/inspect.mjs <файл.unr|u|utx>");
  process.exit(1);
}

try {
  const summary = readPackageSummary(path.resolve(filePath));
  console.log(`Файл:      ${path.resolve(filePath)}`);
  console.log(`Размер:    ${summary.size} байт`);
  console.log(`Версия:    ${summary.header.version}`);
  console.log(`Лицензия:  ${summary.header.licenseMode}`);
  console.log(`Флаги:     0x${summary.header.flags.toString(16)}`);
  console.log(`Имён:      ${summary.header.nameCount}`);
  console.log(`Импортов:  ${summary.header.importCount}`);
  console.log(`Экспортов: ${summary.header.exportCount}`);

  const counts = new Map();
  for (const item of summary.exports) {
    const key = item.className ?? "?";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log("Экспорты по классам:");
  for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${name}: ${count}`);
  }

  const level = summary.exports.find((item) => item.className === "Level");
  if (level) {
    console.log(`Level:     ${level.objectName}, ${level.serialSize} байт @ ${level.serialOffset}`);
  }
  const models = summary.exports
    .filter((item) => item.className === "Model" && item.serialSize > 1000)
    .sort((a, b) => b.serialSize - a.serialSize)
    .slice(0, 3);
  if (models.length) {
    console.log("Крупные Model (BSP):");
    for (const model of models) console.log(`  ${model.objectName}: ${model.serialSize} байт @ ${model.serialOffset}`);
  }
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
