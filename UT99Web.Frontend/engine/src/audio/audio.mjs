import { BinaryReader } from "../package/binary-reader.mjs";
import { skipTaggedProperties } from "../level/model.mjs";

function readObjectData(pkg, item, kind) {
  if (!pkg || !item) throw new Error(`Не передан ${kind}-объект`);
  if (item.className !== kind) {
    throw new Error(`Объект ${item.objectName ?? "(без имени)"} не является ${kind}`);
  }
  const reader = new BinaryReader(pkg.buffer, item.serialOffset);
  skipTaggedProperties(reader, pkg.names);
  const formatIndex = reader.compactIndex();
  const format = pkg.names[formatIndex]?.text;
  if (!format) throw new Error(`Не удалось прочитать формат ${kind} ${item.objectName ?? ""}`);
  if (pkg.header.version >= 63) reader.u32();
  const size = reader.compactIndex();
  if (size < 0) throw new Error(`Отрицательный размер ${kind} ${item.objectName ?? ""}`);
  const data = reader.bytes(size);
  return { format, data };
}

export function readSoundObject(pkg, item) {
  return readObjectData(pkg, item, "Sound");
}

export function readMusicObject(pkg, item) {
  return readObjectData(pkg, item, "Music");
}

function ascii(buffer, offset, length) {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    const byte = buffer[offset + index];
    if (byte === undefined) return text;
    text += String.fromCharCode(byte);
  }
  return text;
}

export function parseWav(buffer) {
  if (!(buffer instanceof Uint8Array)) {
    throw new TypeError("WAV должен быть Uint8Array или Buffer");
  }
  if (buffer.length < 12) throw new Error("WAV короче 12 байт");
  if (ascii(buffer, 0, 4) !== "RIFF" || ascii(buffer, 8, 4) !== "WAVE") {
    throw new Error("Нет сигнатуры RIFF/WAVE");
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 12;
  let format = null;
  let dataSize = 0;
  let hasData = false;

  while (offset + 8 <= buffer.length) {
    const id = ascii(buffer, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "data") {
      dataSize = Math.min(size, buffer.length - body);
      hasData = true;
      offset = body + size + (size % 2);
      continue;
    }
    if (body + size > buffer.length) throw new Error(`Чанк ${id} выходит за пределы WAV`);
    if (id === "fmt ") {
      if (size < 16) throw new Error("Слишком короткий fmt-чанк");
      format = {
        tag: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        byteRate: view.getUint32(body + 8, true),
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true)
      };
    }
    offset = body + size + (size % 2);
  }

  if (!format) throw new Error("В WAV нет fmt-чанка");
  if (!hasData) throw new Error("В WAV нет data-чанка");
  if (format.tag !== 1) throw new Error(`WAV не PCM: tag=${format.tag}`);
  if (format.channels !== 1) throw new Error(`Ожидался моно-WAV, каналов: ${format.channels}`);
  if (format.bitsPerSample !== 8 && format.bitsPerSample !== 16) {
    throw new Error(`Неподдерживаемая битность WAV: ${format.bitsPerSample}`);
  }
  if (!(format.sampleRate > 0)) throw new Error("Некорректная частота дискретизации WAV");
  if (!(dataSize > 0)) throw new Error("Пустой data-чанк WAV");

  const bytesPerSample = format.bitsPerSample / 8;
  const duration = dataSize / (format.sampleRate * format.channels * bytesPerSample);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Некорректная длительность WAV");

  return {
    tag: format.tag,
    channels: format.channels,
    sampleRate: format.sampleRate,
    bitsPerSample: format.bitsPerSample,
    dataSize,
    duration
  };
}

export function detectMusicFormat(buffer) {
  if (!(buffer instanceof Uint8Array) || buffer.length < 4) return null;
  if (ascii(buffer, 0, 4) === "IMPM") return "it";
  if (ascii(buffer, 0, 17) === "Extended Module: ") return "xm";
  if (ascii(buffer, 44, 4) === "SCRM") return "s3m";
  const signature = ascii(buffer, 0, 4);
  if (["M.K.", "M!K!", "FLT4", "FLT8", "4CHN", "6CHN", "8CHN"].includes(signature)) return "mod";
  return null;
}
