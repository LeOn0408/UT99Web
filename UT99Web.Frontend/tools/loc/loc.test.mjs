import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDirectory,
  decodeBuffer,
  encodeText,
  extractDirectory,
  loadPackageDirectory,
  mergeWithBase,
  parseIntText,
  serializeIntText,
  validatePackages
} from "./lib.mjs";

const fixtures = path.join(import.meta.dirname, "fixtures");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ut99web-loc-"));
}

test("разбирает секции и ключи .int", () => {
  const parsed = parseIntText("; comment\n[UTMenu.Menu]\nPlay=Play\nQuit=Quit\n\n[UTMenu.Settings]\nVideo=Video\n");
  assert.deepEqual(parsed.sections, {
    "UTMenu.Menu": { Play: "Play", Quit: "Quit" },
    "UTMenu.Settings": { Video: "Video" }
  });
});

test("предупреждает о повторяющемся ключе", () => {
  const parsed = parseIntText("[Menu]\nPlay=One\nPlay=Two\n");
  assert.equal(parsed.sections.Menu.Play, "Two");
  assert.equal(parsed.warnings.length, 1);
});

test("сериализует .int в CRLF", () => {
  const text = serializeIntText({ Menu: { Play: "Play" } });
  assert.equal(text, "[Menu]\r\nPlay=Play\r\n");
});

test("кодирует и декодирует windows-1251", () => {
  const bytes = encodeText("Привет", "windows-1251");
  assert.equal(decodeBuffer(bytes, "windows-1251"), "Привет");
});

test("кодирует utf-16le с BOM и определяет её при чтении", () => {
  const bytes = encodeText("Привет", "utf-16le", { bom: true });
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(decodeBuffer(bytes), "Привет");
});

test("сливает перевод с английским fallback", () => {
  const merged = mergeWithBase(
    { Menu: { Play: "Play", Options: "Options", Quit: "Quit" } },
    { Menu: { Play: "Играть", Quit: "Выход" } }
  );
  assert.deepEqual(merged, { Menu: { Play: "Играть", Options: "Options", Quit: "Выход" } });
});

test("валидирует покрытие, пропуски и лишние ключи", () => {
  const base = new Map([
    ["UTMenu.json", { Menu: { Play: "Play", Options: "Options", Quit: "Quit" } }]
  ]);
  const lang = new Map([
    ["UTMenu.json", { Menu: { Play: "Играть", Quit: "Выход", Extra: "Лишнее" } }]
  ]);
  const report = validatePackages(base, lang);
  assert.equal(report.total, 3);
  assert.equal(report.translated, 2);
  assert.ok(report.warnings.some((item) => item.includes("Options")));
  assert.ok(report.warnings.some((item) => item.includes("Extra")));
  assert.equal(report.errors.length, 0);
});

test("извлекает .int в JSON и собирает обратно с fallback", () => {
  const work = tempDir();
  const en = path.join(work, "en");
  const ru = path.join(work, "ru");
  const out = path.join(work, "out");

  extractDirectory(path.join(fixtures, "System"), en, { encoding: "utf-8" });
  extractDirectory(path.join(fixtures, "lang"), ru, { encoding: "utf-8" });

  const built = buildDirectory(en, ru, out, { encoding: "utf-16le", bom: true });
  const file = path.join(out, "UTMenu.int");
  assert.ok(fs.existsSync(file));
  assert.equal(built.report.errors.length, 0);

  const parsed = parseIntText(decodeBuffer(fs.readFileSync(file), "utf-16le"));
  assert.deepEqual(parsed.sections, {
    "UTMenu.Menu": { Play: "Играть", Options: "Options", Quit: "Выход" },
    "UTMenu.Settings": { Video: "Видео", Audio: "Audio" }
  });
  assert.equal(loadPackageDirectory(en).size, 1);
});
