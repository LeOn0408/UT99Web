import { BinaryReader } from "../package/binary-reader.mjs";
import { readTaggedProperties } from "../package/properties.mjs";

export const TEXTURE_FORMAT = {
  P8: 0,
  RGBA7: 1,
  RGB16: 2,
  DXT1: 3,
  RGB8: 4,
  RGBA8: 5
};

export function readTexture(pkg, exportItem) {
  const reader = new BinaryReader(pkg.buffer, exportItem.serialOffset);
  const properties = readTaggedProperties(reader, pkg.names);
  const mipCount = reader.u8();
  if (mipCount > 16) throw new Error(`Слишком много mip-уровней: ${mipCount}`);

  const mips = [];
  for (let index = 0; index < mipCount; index += 1) {
    const lazyOffset = pkg.header.version >= 63 ? reader.u32() : null;
    const size = reader.compactIndex();
    const data = reader.bytes(size);
    const width = reader.u32();
    const height = reader.u32();
    const bitsWidth = reader.u8();
    const bitsHeight = reader.u8();
    mips.push({ lazyOffset, size, data, width, height, bitsWidth, bitsHeight });
  }

  const format = properties.get("Format")?.value ?? TEXTURE_FORMAT.P8;
  const paletteRef = properties.get("Palette")?.value ?? null;
  return {
    format,
    paletteRef,
    mips,
    width: mips[0]?.width ?? 0,
    height: mips[0]?.height ?? 0,
    properties
  };
}

export function readPalette(pkg, exportItem) {
  const reader = new BinaryReader(pkg.buffer, exportItem.serialOffset);
  readTaggedProperties(reader, pkg.names);
  const count = reader.compactIndex();
  if (count < 1 || count > 4096) throw new Error(`Некорректный размер палитры: ${count}`);
  const colors = new Array(count);
  for (let index = 0; index < count; index += 1) {
    colors[index] = { r: reader.u8(), g: reader.u8(), b: reader.u8(), a: reader.u8() };
  }
  return colors;
}

function rgb565(value) {
  const r = Math.round((((value >> 11) & 0x1f) * 255) / 31);
  const g = Math.round((((value >> 5) & 0x3f) * 255) / 63);
  const b = Math.round(((value & 0x1f) * 255) / 31);
  return [r, g, b];
}

function decodeDxtColor(source, offset, target, targetOffset, width, alpha) {
  const c0 = source[offset] | (source[offset + 1] << 8);
  const c1 = source[offset + 2] | (source[offset + 3] << 8);
  const color0 = rgb565(c0);
  const color1 = rgb565(c1);
  const palette = [color0, color1];
  if (c0 > c1 || alpha) {
    palette.push([
      Math.round((color0[0] * 2 + color1[0]) / 3),
      Math.round((color0[1] * 2 + color1[1]) / 3),
      Math.round((color0[2] * 2 + color1[2]) / 3)
    ]);
    palette.push([
      Math.round((color0[0] + color1[0] * 2) / 3),
      Math.round((color0[1] + color1[1] * 2) / 3),
      Math.round((color0[2] + color1[2] * 2) / 3)
    ]);
  } else {
    palette.push([
      Math.round((color0[0] + color1[0]) / 2),
      Math.round((color0[1] + color1[1]) / 2),
      Math.round((color0[2] + color1[2]) / 2)
    ]);
    palette.push([0, 0, 0]);
  }
  let bits = source[offset + 4] | (source[offset + 5] << 8) | (source[offset + 6] << 16) | (source[offset + 7] << 24);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const color = palette[bits & 3];
      const pixel = ((targetOffset >> 2) + y) * width + ((targetOffset & 3) + x);
      const base = pixel * 4;
      target[base] = color[0];
      target[base + 1] = color[1];
      target[base + 2] = color[2];
      target[base + 3] = 255;
      bits >>>= 2;
    }
  }
}

function decodeDxt1(data, width, height) {
  const target = new Uint8Array(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const source = (by * blocksX + bx) * 8;
      const targetOffset = (by * 4) * width + bx * 4;
      decodeDxtColor(data, source, target, targetOffset, width, false);
    }
  }
  return target;
}

function decodeDxt3(data, width, height) {
  const target = new Uint8Array(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const source = (by * blocksX + bx) * 16;
      const targetOffset = (by * 4) * width + bx * 4;
      decodeDxtColor(data, source + 8, target, targetOffset, width, true);
      for (let y = 0; y < 4; y += 1) {
        const rowAlpha = data[source + y * 2] | (data[source + y * 2 + 1] << 8);
        for (let x = 0; x < 4; x += 1) {
          const alpha = (rowAlpha >> (x * 4)) & 0x0f;
          const pixel = ((targetOffset >> 2) + y) * width + ((targetOffset & 3) + x);
          target[pixel * 4 + 3] = alpha * 17;
        }
      }
    }
  }
  return target;
}

export function decodeTextureImage(texture, palette) {
  const mip = texture.mips[0];
  if (!mip) return { width: 0, height: 0, data: new Uint8Array(0) };
  const { width, height } = mip;

  if (texture.format === TEXTURE_FORMAT.P8) {
    const data = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      const color = palette?.[mip.data[index]] ?? { r: 255, g: 0, b: 255, a: 255 };
      const base = index * 4;
      data[base] = color.r;
      data[base + 1] = color.g;
      data[base + 2] = color.b;
      data[base + 3] = color.a;
    }
    return { width, height, data };
  }

  if (texture.format === TEXTURE_FORMAT.RGB8) {
    const data = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      const base = index * 4;
      data[base] = mip.data[index * 3 + 2];
      data[base + 1] = mip.data[index * 3 + 1];
      data[base + 2] = mip.data[index * 3];
      data[base + 3] = 255;
    }
    return { width, height, data };
  }

  if (texture.format === TEXTURE_FORMAT.RGBA8) {
    const data = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      const base = index * 4;
      data[base] = mip.data[base + 2];
      data[base + 1] = mip.data[base + 1];
      data[base + 2] = mip.data[base];
      data[base + 3] = mip.data[base + 3];
    }
    return { width, height, data };
  }

  if (texture.format === TEXTURE_FORMAT.DXT1) {
    return { width, height, data: decodeDxt1(mip.data, width, height) };
  }

  throw new Error(`Неподдерживаемый формат текстуры: ${texture.format}`);
}
