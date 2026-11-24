const UZ_VERSION_LEGACY = 0x162e;
const UZ_VERSION_469 = 0x04d2;
const MAX_BLOCK = 16 * 1024 * 1024;
const MAX_OUTPUT = 512 * 1024 * 1024;

function viewOf(buffer) {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

class BitReader {
  constructor(buffer, offset) {
    this.buffer = buffer;
    this.position = offset * 8;
    this.limit = buffer.length * 8;
  }

  readBit() {
    if (this.position >= this.limit) throw new Error("Неожиданный конец битового потока");
    const byte = this.buffer[this.position >> 3];
    const bit = (byte >> (this.position & 7)) & 1;
    this.position += 1;
    return bit;
  }

  readByte() {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) value |= this.readBit() << bit;
    return value;
  }
}

export function huffmanDecode(buffer) {
  if (buffer.length < 4) throw new Error("Нет заголовка Хаффмана");
  const total = viewOf(buffer).getInt32(0, true);
  if (total < 0 || total > MAX_OUTPUT) throw new Error(`Недопустимый размер: ${total}`);
  const reader = new BitReader(buffer, 4);

  function readTable(depth = 0) {
    if (depth > 256) throw new Error("Слишком глубокая таблица Хаффмана");
    if (reader.readBit()) {
      return { left: readTable(depth + 1), right: readTable(depth + 1) };
    }
    return { value: reader.readByte() };
  }

  const root = readTable();
  const output = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    let node = root;
    while (node.value === undefined) node = reader.readBit() ? node.right : node.left;
    output[index] = node.value;
  }
  return output;
}

export function rleDecode(buffer) {
  const output = [];
  let previous = 0;
  let count = 0;
  let offset = 0;
  while (offset < buffer.length) {
    const byte = buffer[offset++];
    output.push(byte);
    if (byte !== previous) {
      previous = byte;
      count = 1;
    } else {
      count += 1;
      if (count === 5) {
        if (offset >= buffer.length) throw new Error("Обрыв RLE-потока");
        const repeat = buffer[offset++];
        if (repeat < 2) throw new Error(`Некорректная длина RLE: ${repeat}`);
        for (let extra = 0; extra < repeat - 5; extra += 1) output.push(byte);
        count = 0;
      }
    }
  }
  return Uint8Array.from(output);
}

export function mtfDecode(buffer) {
  const list = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) list[index] = index;
  const output = new Uint8Array(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    const position = buffer[index];
    const value = list[position];
    output[index] = value;
    for (let move = position; move > 0; move -= 1) list[move] = list[move - 1];
    list[0] = value;
  }
  return output;
}

export function bwtDecode(buffer) {
  const view = viewOf(buffer);
  const chunks = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error("Обрыв заголовка BWT");
    const length = view.getInt32(offset, true);
    const first = view.getInt32(offset + 4, true);
    const last = view.getInt32(offset + 8, true);
    offset += 12;
    if (length < 0 || length > MAX_BLOCK) throw new Error(`Некорректный блок BWT: ${length}`);
    const size = length + 1;
    if (offset + size > buffer.length) throw new Error("Обрыв данных BWT");
    const source = buffer.subarray(offset, offset + size);
    offset += size;

    const counts = new Uint32Array(257);
    for (let index = 0; index < size; index += 1) {
      counts[index !== last ? source[index] : 256] += 1;
    }
    const running = new Uint32Array(257);
    let sum = 0;
    for (let index = 0; index < 257; index += 1) {
      running[index] = sum;
      sum += counts[index];
      counts[index] = 0;
    }
    const positions = new Uint32Array(size);
    for (let index = 0; index < size; index += 1) {
      const symbol = index !== last ? source[index] : 256;
      positions[running[symbol] + counts[symbol]] = index;
      counts[symbol] += 1;
    }
    let position = first;
    for (let index = 0; index < length; index += 1) {
      chunks.push(source[position]);
      position = positions[position];
    }
  }
  return Uint8Array.from(chunks);
}

function decodeLatin1(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

export function decompressUz(buffer) {
  if (buffer.length < 6) throw new Error("Файл .uz слишком мал");
  const version = viewOf(buffer).getUint32(0, true);
  if (version !== UZ_VERSION_LEGACY && version !== UZ_VERSION_469) {
    throw new Error(`Неизвестная версия .uz: 0x${version.toString(16)}`);
  }
  const nameLength = buffer[4];
  if (nameLength < 1 || 5 + nameLength > buffer.length) {
    throw new Error(`Некорректная длина имени: ${nameLength}`);
  }
  const name = decodeLatin1(buffer.subarray(5, 5 + nameLength)).replace(/\0+$/, "");
  const payload = buffer.subarray(5 + nameLength);

  let data = huffmanDecode(payload);
  if (version === UZ_VERSION_LEGACY) {
    data = rleDecode(data);
    data = mtfDecode(data);
    data = bwtDecode(data);
    data = rleDecode(data);
  } else {
    data = mtfDecode(data);
    data = bwtDecode(data);
    data = rleDecode(data);
  }
  return { version, name, data };
}
