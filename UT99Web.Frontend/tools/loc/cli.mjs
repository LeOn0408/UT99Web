#!/usr/bin/env node
import path from "node:path";
import {
  buildDirectory,
  extractDirectory,
  loadPackageDirectory,
  validatePackages
} from "./lib.mjs";

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split("=");
    if (inline !== undefined) {
      options[name] = inline;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      options[name] = argv[index + 1];
      index += 1;
    } else {
      options[name] = true;
    }
  }
  return options;
}

function formatCoverage(report) {
  const percent = (report.coverage * 100).toFixed(1);
  return `${report.translated}/${report.total} строк (${percent}%)`;
}

function printReport(report) {
  for (const error of report.errors) console.error(`ОШИБКА  ${error}`);
  for (const warning of report.warnings) console.warn(`ВНИМАНИЕ ${warning}`);
  console.log(`Покрытие перевода: ${formatCoverage(report)}`);
}

function requireOption(options, name) {
  const value = options[name] ?? options._.shift();
  if (!value || value === true) throw new Error(`Не указан --${name}`);
  return value;
}

const [command, ...rest] = process.argv.slice(2);
const options = parseArgs(rest);

try {
  if (command === "extract") {
    const source = requireOption(options, "src");
    const output = requireOption(options, "out");
    const result = extractDirectory(source, output, {
      encoding: options.encoding || "windows-1252"
    });
    for (const warning of result.warnings) console.warn(`ВНИМАНИЕ ${warning}`);
    console.log(`Извлечено файлов: ${result.written.length}`);
  } else if (command === "build") {
    const base = requireOption(options, "base");
    const lang = requireOption(options, "lang");
    const output = requireOption(options, "out");
    const result = buildDirectory(base, lang, output, {
      encoding: options.encoding || "utf-16le",
      bom: options.bom === true
    });
    printReport(result.report);
    if (result.report.errors.length) process.exitCode = 1;
    else console.log(`Собрано файлов: ${result.written.length} → ${path.resolve(output)}`);
  } else if (command === "validate") {
    const base = requireOption(options, "base");
    const lang = requireOption(options, "lang");
    const report = validatePackages(
      loadPackageDirectory(base),
      loadPackageDirectory(lang)
    );
    printReport(report);
    if (report.errors.length) process.exitCode = 1;
  } else {
    console.error("Использование:");
    console.error("  node tools/loc/cli.mjs extract --src <System> --out localization/en [--encoding windows-1252]");
    console.error("  node tools/loc/cli.mjs validate --base localization/en --lang localization/ru");
    console.error("  node tools/loc/cli.mjs build --base localization/en --lang localization/ru --out web/dist/localization [--encoding utf-16le] [--bom]");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
