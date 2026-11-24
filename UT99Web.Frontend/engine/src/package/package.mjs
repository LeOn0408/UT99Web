import { BinaryReader } from "./binary-reader.mjs";

export const PACKAGE_SIGNATURE = 0x9e2a83c1;
export const PACKAGE_HEADER_SIZE = 36;

export function readPackageHeader(reader) {
  reader.seek(0);
  const signature = reader.u32();
  if (signature !== PACKAGE_SIGNATURE) {
    throw new Error(`Неизвестная сигнатура пакета 0x${signature.toString(16)}`);
  }
  return {
    signature,
    version: reader.u16(),
    licenseMode: reader.u16(),
    flags: reader.u32(),
    nameCount: reader.u32(),
    nameOffset: reader.u32(),
    exportCount: reader.u32(),
    exportOffset: reader.u32(),
    importCount: reader.u32(),
    importOffset: reader.u32()
  };
}

export function readNameTable(reader, header) {
  if (header.nameCount > 1_000_000) {
    throw new Error(`Подозрительно много имён: ${header.nameCount}`);
  }
  reader.seek(header.nameOffset);
  const names = [];
  for (let index = 0; index < header.nameCount; index += 1) {
    const text = header.version <= 61 ? reader.cstring() : reader.fstring();
    names.push({ text, flags: reader.u32() });
  }
  return names;
}

export function readImportTable(reader, header, names) {
  reader.seek(header.importOffset);
  const imports = [];
  for (let index = 0; index < header.importCount; index += 1) {
    const classPackageIndex = reader.compactIndex();
    const classNameIndex = reader.compactIndex();
    const packageIndex = reader.i32();
    const objectNameIndex = reader.compactIndex();
    imports.push({
      classPackage: names[classPackageIndex]?.text ?? null,
      className: names[classNameIndex]?.text ?? null,
      packageIndex,
      objectName: names[objectNameIndex]?.text ?? null
    });
  }
  return imports;
}

export function readExportTable(reader, header, names) {
  reader.seek(header.exportOffset);
  const exports = [];
  for (let index = 0; index < header.exportCount; index += 1) {
    const classIndex = reader.compactIndex();
    const superIndex = reader.compactIndex();
    const packageIndex = reader.i32();
    const objectNameIndex = reader.compactIndex();
    const objectFlags = reader.u32();
    const serialSize = reader.compactIndex();
    const serialOffset = serialSize ? reader.compactIndex() : 0;
    exports.push({
      index,
      classIndex,
      superIndex,
      packageIndex,
      objectName: names[objectNameIndex]?.text ?? null,
      objectFlags,
      serialSize,
      serialOffset
    });
  }
  return exports;
}

export function resolveObjectName(index, exports, imports) {
  if (index < 0) return imports[-index - 1]?.objectName ?? null;
  if (index === 0) return null;
  return exports[index - 1]?.objectName ?? null;
}

export function readPackage(buffer) {
  const reader = new BinaryReader(buffer);
  const header = readPackageHeader(reader);
  const names = readNameTable(reader, header);
  const imports = readImportTable(reader, header, names);
  const exports = readExportTable(reader, header, names);
  for (const item of exports) {
    item.className = resolveObjectName(item.classIndex, exports, imports);
  }
  return { header, names, imports, exports, size: buffer.length, buffer };
}
