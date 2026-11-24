import assert from "node:assert/strict";
import test from "node:test";
import { BinaryReader } from "../src/package/binary-reader.mjs";
import {
  PACKAGE_SIGNATURE,
  readNameTable,
  readPackageHeader
} from "../src/package/package-reader.mjs";

function fstring(value) {
  const body = Buffer.from(value, "latin1");
  return Buffer.concat([Buffer.from([body.length + 1]), body, Buffer.from([0])]);
}

function nameEntry(value, flags = 0) {
  const flagsBuffer = Buffer.alloc(4);
  flagsBuffer.writeUInt32LE(flags);
  return Buffer.concat([fstring(value), flagsBuffer]);
}

function makePackage() {
  const names = Buffer.concat([nameEntry("Core"), nameEntry("Level", 0x10)]);
  const header = Buffer.alloc(36);
  header.writeUInt32LE(PACKAGE_SIGNATURE, 0);
  header.writeUInt16LE(68, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(2, 12);
  header.writeUInt32LE(36, 16);
  header.writeUInt32LE(0, 20);
  header.writeUInt32LE(0, 24);
  header.writeUInt32LE(0, 28);
  header.writeUInt32LE(0, 32);
  return Buffer.concat([header, names]);
}

test("читает заголовок пакета UE1", () => {
  const reader = new BinaryReader(makePackage());
  const header = readPackageHeader(reader);
  assert.equal(header.signature, PACKAGE_SIGNATURE);
  assert.equal(header.version, 68);
  assert.equal(header.nameCount, 2);
  assert.equal(header.nameOffset, 36);
});

test("читает таблицу имён", () => {
  const buffer = makePackage();
  const reader = new BinaryReader(buffer);
  const header = readPackageHeader(reader);
  const names = readNameTable(reader, header);
  assert.deepEqual(names, [
    { text: "Core", flags: 0 },
    { text: "Level", flags: 0x10 }
  ]);
});

test("читает compact index", () => {
  const reader = new BinaryReader(Buffer.from([0x05, 0x85, 0x40, 0x01, 0x68, 0x0f]));
  assert.equal(reader.compactIndex(), 5);
  assert.equal(reader.compactIndex(), -5);
  assert.equal(reader.compactIndex(), 64);
  assert.equal(reader.compactIndex(), 1000);
});

test("отклоняет файл с чужой сигнатурой", () => {
  const buffer = makePackage();
  buffer.writeUInt32LE(0x12345678, 0);
  assert.throws(() => readPackageHeader(new BinaryReader(buffer)), /сигнатура/i);
});
