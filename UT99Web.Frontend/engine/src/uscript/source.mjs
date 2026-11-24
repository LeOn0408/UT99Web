import fs from "node:fs";
import path from "node:path";

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

function findBlock(source, start) {
  const open = source.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  let inString = false;
  let quote = "";
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return { body: source.slice(open + 1, index), end: index + 1 };
    }
  }
  return null;
}

function parseDefaultEntries(body) {
  const entries = new Map();
  let current = "";
  let parenDepth = 0;
  let braceDepth = 0;
  let inString = false;
  let quote = "";
  let objectDepth = 0;

  const flush = () => {
    const line = current.trim();
    current = "";
    if (!line) return;
    if (/^Begin\s+(Object|Class)\b/i.test(line)) {
      objectDepth += 1;
      return;
    }
    if (/^End\s+(Object|Class)\b/i.test(line)) {
      objectDepth = Math.max(0, objectDepth - 1);
      return;
    }
    if (objectDepth > 0) return;
    const separator = line.indexOf("=");
    if (separator < 0) {
      entries.set(line, "");
      return;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    entries.set(key, value);
  };

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (inString) {
      current += char;
      if (char === "\\") {
        index += 1;
        if (index < body.length) current += body[index];
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);

    if (char === "\n" && parenDepth === 0 && braceDepth === 0) {
      flush();
    } else {
      current += char;
    }
  }
  flush();
  return entries;
}

function parseDefaults(source) {
  const match = /defaultproperties\b/i.exec(source);
  if (!match) return new Map();
  const block = findBlock(source, match.index + match[0].length);
  if (!block) return new Map();
  return parseDefaultEntries(block.body);
}

const VARIABLE_MODIFIERS = /\b(?:config|globalconfig|private|protected|public|travel|transient|native|const|editconst|editinline|export|noexport|deprecated|localized|input|notforconsole|repnotify|automated|noexportheader|duplicatetransient)\b/g;

function parseVariables(source) {
  const variables = new Map();
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*var\b(?:\([^)]*\))?\s*([^;]+);/.exec(line);
    if (!match) continue;
    const cleaned = match[1].replace(VARIABLE_MODIFIERS, " ").replace(/\s+/g, " ").trim();
    const typeMatch = /^(class\s*<[^>]+>|array\s*<[^>]+>|struct\s+[A-Za-z_]\w*|class|array|[A-Za-z_]\w*)\s+(.+)$/.exec(cleaned);
    if (!typeMatch) continue;
    const type = typeMatch[1];
    for (const rawName of typeMatch[2].split(",")) {
      const name = rawName.trim().replace(/\[[^\]]*\]$/, "");
      if (name) variables.set(name, { type, declaration: line.trim() });
    }
  }
  return variables;
}

export function parseScriptSource(text) {
  const source = stripComments(text);
  const classMatch = /(?:^|\n)\s*(?:class|interface)\s+([A-Za-z_]\w*)(?:\s+extends\s+([A-Za-z_]\w*))?/i.exec(source);
  const defaults = parseDefaults(source);
  const variables = parseVariables(source);
  const functions = [];
  const functionPattern = /^\s*(?:function|event|delegate)\s+([^;{]+)/gim;
  for (let match = functionPattern.exec(source); match; match = functionPattern.exec(source)) {
    functions.push(match[1].trim().split(/\s+/).pop().replace(/\(.*$/, ""));
  }

  return {
    className: classMatch?.[1] ?? null,
    superName: classMatch?.[2] ?? null,
    variables,
    functions,
    defaults,
    hasDefaultProperties: defaults.size > 0
  };
}

export function loadScriptDirectory(directory) {
  const scripts = new Map();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".uc")) continue;
    const file = path.join(directory, entry.name);
    const parsed = parseScriptSource(fs.readFileSync(file, "utf8"));
    const name = parsed.className ?? path.basename(entry.name, ".uc");
    scripts.set(name, { ...parsed, file });
  }
  return scripts;
}

export function coerceDefault(entry) {
  if (entry === undefined) return undefined;
  const value = entry.trim();
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/i.test(value)) return Number(value);
  if (value.startsWith("\"") && value.endsWith("\"")) return value.slice(1, -1);
  const objectMatch = /^[A-Za-z_]\w*'(.*)'$/.exec(value);
  if (objectMatch) return { object: objectMatch[1] };
  return value;
}

export function defaultValue(script, name) {
  return coerceDefault(script?.defaults.get(name));
}
