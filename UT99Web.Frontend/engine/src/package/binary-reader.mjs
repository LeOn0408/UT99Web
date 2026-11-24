export class BinaryReader {
  constructor(buffer, offset = 0) {
    this.buffer = buffer;
    this.offset = offset;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  get remaining() {
    return this.buffer.length - this.offset;
  }

  ensure(size) {
    if (size < 0 || this.offset + size > this.buffer.length) {
      throw new RangeError(
        `Чтение вне файла: нужно ${size} байт по смещению ${this.offset}, доступно ${this.remaining}`
      );
    }
  }

  seek(offset) {
    if (offset < 0 || offset > this.buffer.length) {
      throw new RangeError(`Недопустимое смещение ${offset}`);
    }
    this.offset = offset;
    return this;
  }

  skip(size) {
    this.ensure(size);
    this.offset += size;
    return this;
  }

  u8() {
    this.ensure(1);
    return this.buffer[this.offset++];
  }

  u16() {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  i16() {
    this.ensure(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  f32() {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u32() {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  i32() {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  bytes(size) {
    this.ensure(size);
    const value = this.buffer.subarray(this.offset, this.offset + size);
    this.offset += size;
    return value;
  }

  compactIndex() {
    let byte = this.u8();
    const negative = (byte & 0x80) !== 0;
    let value = byte & 0x3f;
    if (byte & 0x40) {
      let shift = 6;
      do {
        byte = this.u8();
        value |= (byte & 0x7f) << shift;
        shift += 7;
      } while (byte & 0x80 && shift < 35);
    }
    return negative ? -value : value;
  }

  cstring() {
    let text = "";
    for (;;) {
      const byte = this.u8();
      if (byte === 0) return text;
      text += String.fromCharCode(byte);
    }
  }

  fstring() {
    let length = this.u8();
    if (length & 0x80) {
      const high = this.u8();
      length = (length & 0x7f) | (high << 7);
    }
    if (length === 0) return "";
    const raw = this.bytes(length);
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) end -= 1;
    let text = "";
    for (let index = 0; index < end; index += 1) text += String.fromCharCode(raw[index]);
    return text;
  }
}
