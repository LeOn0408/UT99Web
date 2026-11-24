export const PROPERTY_TYPES = [
  "Unknown",
  "Byte",
  "Integer",
  "Boolean",
  "Float",
  "Object",
  "Name",
  "String",
  "Class",
  "Array",
  "Struct",
  "Vector",
  "Rotator",
  "Str",
  "Map",
  "Fixed Array"
];

function readSize(reader, code) {
  switch (code) {
    case 0: return 1;
    case 1: return 2;
    case 2: return 4;
    case 3: return 12;
    case 4: return 16;
    case 5: return reader.u8();
    case 6: return reader.u16();
    case 7: return reader.u32();
    default: return 1;
  }
}

function readVector(reader) {
  return { x: reader.f32(), y: reader.f32(), z: reader.f32() };
}

function readValue(reader, type, subtype, size, booleanValue) {
  switch (type) {
    case 1: return reader.u8();
    case 2: return reader.i32();
    case 3: return booleanValue;
    case 4: return reader.f32();
    case 5: return reader.compactIndex();
    case 6: return reader.compactIndex();
    case 11: return readVector(reader);
    case 12: return { pitch: reader.i32(), yaw: reader.i32(), roll: reader.i32() };
    case 10:
      if (subtype === "Color") {
        return { b: reader.u8(), g: reader.u8(), r: reader.u8(), a: reader.u8() };
      }
      if (subtype === "Vector") return readVector(reader);
      if (subtype === "Rotator") {
        return { pitch: reader.i32(), yaw: reader.i32(), roll: reader.i32() };
      }
      if (subtype === "Scale") {
        return {
          x: reader.f32(),
          y: reader.f32(),
          z: reader.f32(),
          sheerRate: reader.u32(),
          sheerAxis: reader.u8()
        };
      }
      if (subtype === "PointRegion") {
        return { zone: reader.compactIndex(), leaf: reader.u32(), zoneNumber: reader.u8() };
      }
      reader.skip(size);
      return null;
    default:
      reader.skip(size);
      return null;
  }
}

export function readTaggedProperties(reader, names) {
  const properties = new Map();
  let previous = null;

  for (;;) {
    const nameIndex = reader.compactIndex();
    const name = names[nameIndex]?.text;
    if (name === undefined) throw new Error(`Неизвестное имя свойства: ${nameIndex}`);
    if (name.toLowerCase() === "none") break;

    const info = reader.u8();
    const type = info & 0x0f;
    const sizeCode = (info >> 4) & 0x07;
    const arrayFlag = (info & 0x80) !== 0;

    let subtype = null;
    if (type === 10) subtype = names[reader.compactIndex()]?.text ?? null;

    const size = readSize(reader, sizeCode);

    let arrayIndex;
    if (type !== 3 && arrayFlag) {
      if (previous && previous.index !== undefined) {
        if (previous.index >= 0x3fff) arrayIndex = reader.u32() & 0x3fffffff;
        else if (previous.index >= 0x7f) arrayIndex = reader.u16() & 0x7fff;
        else arrayIndex = reader.u8();
      } else {
        arrayIndex = reader.u8();
      }
      if (previous && previous.name === name && previous.subtype === undefined) {
        previous.subtype = "Array";
        previous.index = 0;
      }
    }

    const value = readValue(reader, type, subtype, size, arrayFlag);
    const property = {
      name,
      type: PROPERTY_TYPES[type] ?? "Unknown",
      subtype,
      size,
      arrayIndex,
      value
    };
    properties.set(name, property);
    previous = property;
  }

  return properties;
}
