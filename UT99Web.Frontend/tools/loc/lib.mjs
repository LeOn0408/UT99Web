import fs from "node:fs";
import path from "node:path";

const BOMS = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bytes: [0xff, 0xfe], encoding: "utf-16le" },
  { bytes: [0xfe, 0xff], encoding: "utf-16be" }
];

const ENCODING_ALIASES = {
  ansi: "windows-1252",
  cp1251: "windows-1251",
  cp1252: "windows-1252",
  win1251: "windows-1251",
  win1252: "windows-1252"
};

export function normalizeEncoding(label) {
  const value = String(label || "utf-8").toLowerCase();
  return ENCODING_ALIASES[value] || value;
}

function detectBom(buffer) {
  for (const bom of BOMS) {
    if (bom.bytes.every((byte, index) => buffer[index] === byte)) {
      return { encoding: bom.encoding, offset: bom.bytes.length };
    }
  }
  return { encoding: null, offset: 0 };
}

export function decodeBuffer(buffer, fallbackEncoding = "utf-8") {
  const bom = detectBom(buffer);
  const encoding = bom.encoding || normalizeEncoding(fallbackEncoding);
  const decoder = new TextDecoder(encoding, { fatal: true });
  return decoder.decode(buffer.subarray(bom.offset));
}

function singleByteReverseTable(encoding) {
  const decoder = new TextDecoder(encoding, { fatal: false });
  const table = new Map();
  for (let byte = 0x20; byte <= 0xff; byte += 1) {
    const char = decoder.decode(Uint8Array.of(byte));
    if (char && char !== "\uFFFD" && !table.has(char)) table.set(char, byte);
  }
  return table;
}

export function encodeText(text, encoding = "utf-8", options = {}) {
  const label = normalizeEncoding(encoding);
  const bom = options.bom === true;

  if (label === "utf-8") {
    const body = Buffer.from(text, "utf8");
    return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
  }

  if (label === "utf-16le") {
    const body = Buffer.from(text, "utf16le");
    return bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
  }

  if (label === "utf-16be") {
    const le = Buffer.from(text, "utf16le");
    const body = Buffer.alloc(le.length);
    for (let index = 0; index < le.length; index += 2) {
      body[index] = le[index + 1];
      body[index + 1] = le[index];
    }
    return bom ? Buffer.concat([Buffer.from([0xfe, 0xff]), body]) : body;
  }

  const table = singleByteReverseTable(label);
  const bytes = [];
  for (const char of text) {
    if (char === "\r" || char === "\n" || char === "\t") {
      bytes.push(char.charCodeAt(0));
      continue;
    }
    const byte = table.get(char);
    if (byte === undefined) {
      throw new Error(`Символ ${JSON.stringify(char)} не представим в кодировке ${label}`);
    }
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

export function parseIntText(text) {
  const sections = {};
  const warnings = [];
  let section = null;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) return;

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      if (!section) throw new Error(`Пустое имя секции в строке ${index + 1}`);
      if (!sections[section]) sections[section] = {};
      return;
    }

    const separator = line.indexOf("=");
    if (separator < 0) {
      warnings.push(`Строка ${index + 1}: пропущена, нет "="`);
      return;
    }
    if (section === null) {
      warnings.push(`Строка ${index + 1}: ключ вне секции, пропущена`);
      return;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) {
      warnings.push(`Строка ${index + 1}: пустой ключ, пропущена`);
      return;
    }
    if (Object.hasOwn(sections[section], key)) {
      warnings.push(`Секция [${section}]: ключ "${key}" повторяется, использовано последнее значение`);
    }
    sections[section][key] = value;
  });

  return { sections, warnings };
}

export function serializeIntText(sections) {
  const blocks = [];
  for (const [section, entries] of Object.entries(sections)) {
    const lines = [`[${section}]`];
    for (const [key, value] of Object.entries(entries)) {
      lines.push(`${key}=${value}`);
    }
    blocks.push(lines.join("\r\n"));
  }
  return `${blocks.join("\r\n\r\n")}\r\n`;
}

export function readIntFile(filePath, encoding = "utf-8") {
  return parseIntText(decodeBuffer(fs.readFileSync(filePath), encoding));
}

export function writeIntFile(filePath, sections, encoding = "utf-8", options = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encodeText(serializeIntText(sections), encoding, options));
}

export function listIntFiles(directory) {
  const result = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && /\.int$/i.test(entry.name)) result.push(full);
    }
  }
  return result.sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadPackageDirectory(directory) {
  const files = new Map();
  if (!fs.existsSync(directory)) return files;
  for (const full of listJsonFiles(directory)) {
    const relative = path.relative(directory, full).replace(/\\/g, "/");
    files.set(relative, readJson(full));
  }
  return files;
}

function listJsonFiles(directory) {
  const result = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && /\.json$/i.test(entry.name)) result.push(full);
    }
  }
  return result.sort();
}

export function validatePackages(base, lang) {
  const errors = [];
  const warnings = [];
  let total = 0;
  let translated = 0;

  for (const [file, baseSections] of base) {
    if (!isPlainObject(baseSections)) {
      errors.push(`${file}: корень должен быть объектом`);
      continue;
    }
    const langSections = lang.get(file);
    if (!langSections) {
      warnings.push(`${file}: нет файла перевода, будет использован английский`);
      for (const entries of Object.values(baseSections)) total += Object.keys(entries).length;
      continue;
    }

    for (const [section, baseEntries] of Object.entries(baseSections)) {
      if (!isPlainObject(baseEntries)) {
        errors.push(`${file}: секция "${section}" должна быть объектом`);
        continue;
      }
      const langEntries = langSections[section];
      for (const [key, baseValue] of Object.entries(baseEntries)) {
        total += 1;
        if (!langEntries || !Object.hasOwn(langEntries, key)) {
          warnings.push(`${file} [${section}] ${key}: нет перевода, fallback → "${baseValue}"`);
          continue;
        }
        const value = langEntries[key];
        if (typeof value !== "string" || !value.trim()) {
          errors.push(`${file} [${section}] ${key}: пустой или нестроковый перевод`);
          continue;
        }
        translated += 1;
      }
      if (langEntries) {
        for (const key of Object.keys(langEntries)) {
          if (!Object.hasOwn(baseEntries, key)) {
            warnings.push(`${file} [${section}] ${key}: ключ отсутствует в английской базе`);
          }
        }
      }
    }
  }

  for (const [file, langSections] of lang) {
    if (!base.has(file)) {
      warnings.push(`${file}: файл перевода без английской базы`);
      continue;
    }
    if (!isPlainObject(langSections)) {
      errors.push(`${file}: корень должен быть объектом`);
      continue;
    }
    for (const section of Object.keys(langSections)) {
      if (!Object.hasOwn(base.get(file), section)) {
        warnings.push(`${file} [${section}]: секции нет в английской базе`);
      }
    }
  }

  const coverage = total === 0 ? 0 : translated / total;
  return { errors, warnings, total, translated, coverage };
}

export function mergeWithBase(base, lang) {
  const merged = {};
  for (const [section, baseEntries] of Object.entries(base)) {
    merged[section] = { ...baseEntries };
    const langEntries = lang?.[section];
    if (!langEntries) continue;
    for (const [key, value] of Object.entries(langEntries)) {
      if (!Object.hasOwn(merged[section], key)) continue;
      if (typeof value === "string" && value.trim()) merged[section][key] = value;
    }
  }
  return merged;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function extractDirectory(sourceDirectory, outputDirectory, options = {}) {
  const encoding = options.encoding || "windows-1252";
  const files = listIntFiles(sourceDirectory);
  if (!files.length) throw new Error(`В ${sourceDirectory} не найдено .int файлов`);

  const written = [];
  const warnings = [];
  for (const full of files) {
    const relative = path.relative(sourceDirectory, full).replace(/\\/g, "/");
    const parsed = readIntFile(full, encoding);
    warnings.push(...parsed.warnings.map((message) => `${relative}: ${message}`));
    const target = path.join(outputDirectory, relative.replace(/\.int$/i, ".json"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(parsed.sections, null, 2)}\n`, "utf8");
    written.push(target);
  }
  return { written, warnings };
}

export function buildDirectory(baseDirectory, langDirectory, outputDirectory, options = {}) {
  const encoding = options.encoding || "utf-16le";
  const bom = options.bom === true;
  const base = loadPackageDirectory(baseDirectory);
  const lang = loadPackageDirectory(langDirectory);
  if (!base.size) throw new Error(`Пустой английский пакет: ${baseDirectory}`);

  const report = validatePackages(base, lang);
  const written = [];
  for (const [file, baseSections] of base) {
    const merged = mergeWithBase(baseSections, lang.get(file));
    const target = path.join(outputDirectory, file.replace(/\.json$/i, ".int"));
    writeIntFile(target, merged, encoding, { bom });
    written.push(target);
  }
  return { written, report };
}
