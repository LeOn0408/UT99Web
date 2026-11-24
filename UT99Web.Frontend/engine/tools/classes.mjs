#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readPackage } from "../src/package/package.mjs";
import { classAncestry, findClasses, readClasses } from "../src/uscript/classes.mjs";

const [file, filter] = process.argv.slice(2);
if (!file) {
  console.error("Использование: node engine/tools/classes.mjs <пакет.u> [фильтр]");
  process.exit(1);
}

try {
  const pkg = readPackage(fs.readFileSync(path.resolve(file)));
  const classes = readClasses(pkg);
  console.log(`Пакет: ${path.basename(file)}`);
  console.log(`Классов: ${classes.size}`);

  if (filter) {
    const matched = findClasses(classes, filter);
    for (const name of matched) {
      const info = classes.get(name);
      console.log(`  ${name} <- ${info.superName ?? "—"}`);
    }
    if (matched.length) {
      console.log("Цепочка первого совпадения:");
      console.log(`  ${classAncestry(classes, matched[0]).join(" <- ")}`);
    }
  } else {
    for (const name of findClasses(classes, ".").slice(0, 40)) {
      const info = classes.get(name);
      console.log(`  ${name} <- ${info.superName ?? "—"}`);
    }
  }
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
