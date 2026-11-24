#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { coerceDefault, loadScriptDirectory, parseScriptSource } from "../src/uscript/source.mjs";

const [target, className] = process.argv.slice(2);
if (!target) {
  console.error("Использование: node engine/tools/scriptinfo.mjs <каталог|файл.uc> [класс]");
  process.exit(1);
}

try {
  const resolved = path.resolve(target);
  const stats = fs.statSync(resolved);
  const scripts = stats.isDirectory()
    ? loadScriptDirectory(resolved)
    : (() => {
        const parsed = parseScriptSource(fs.readFileSync(resolved, "utf8"));
        return new Map([[parsed.className ?? path.basename(resolved, ".uc"), parsed]]);
      })();

  console.log(`Источник: ${resolved}`);
  console.log(`Классов: ${scripts.size}`);

  if (!className) {
    for (const [name, script] of [...scripts].slice(0, 40)) {
      console.log(`  ${name} extends ${script.superName ?? "—"} (vars ${script.variables.size}, defaults ${script.defaults.size})`);
    }
    process.exit(0);
  }

  const script = scripts.get(className);
  if (!script) {
    console.error(`Класс не найден: ${className}`);
    process.exitCode = 1;
    process.exit();
  }

  console.log(`Класс: ${script.className} extends ${script.superName ?? "—"}`);
  console.log(`Переменных: ${script.variables.size}, функций: ${script.functions.length}, default properties: ${script.defaults.size}`);
  console.log("Переменные:");
  for (const [name, info] of [...script.variables].slice(0, 30)) {
    console.log(`  ${info.type} ${name}`);
  }
  console.log("Default properties:");
  for (const [key, value] of [...script.defaults].slice(0, 60)) {
    console.log(`  ${key} = ${JSON.stringify(coerceDefault(value))}`);
  }
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
