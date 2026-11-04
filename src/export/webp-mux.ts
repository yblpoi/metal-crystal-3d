/**
 * Minimal WebP muxer for animated, alpha-preserving still frames.
 *
 * Browser canvas.toBlob('image/webp') yields a complete still WebP file. Its
 * ALPH + VP8 (or VP8L) bitstreams are exactly what an ANMF frame needs, but
 * the still's RIFF/VP8X wrapper must not be nested inside ANMF. This module
 * parses the still, extracts the image payload, and writes a fresh
 * VP8X + ANIM + ANMF container.
 *
 * References:
 * - WebP container specification (VP8X / ANIM / ANMF chunk layouts)
 * - RIFF: every chunk is padded to an even size; the padding byte is not part
 *   of the chunk's 32-bit size field.
 */

export type WebpChunkType =
  | 'VP8X'
  | 'ANIM'
  | 'ANMF'
  | 'ALPH'
  | 'VP8 '
  | 'VP8L'
  | 'ICCP'
  | 'EXIF'
  | 'XMP '
  | string;

export interface WebpChunk {
  type: WebpChunkType;
  data: Uint8Array;
}

export interface ParsedStillWebp {
  width: number;
  height: number;
  hasAlpha: boolean;
  chunks: WebpChunk[];
}

export interface WebpAnimationFrame {
  /** ALPH first when present, followed by VP8; or a single VP8L. */
  chunks: WebpChunk[];
  /** Frame display duration in milliseconds, stored as a 24-bit field. */
  durationMs: number;
}

export interface WebpAnimationOptions {
  width: number;
  height: number;
  frames: WebpAnimationFrame[];
  /** 0 = infinite, 1 = one loop. */
  repeat?: number;
  /** BGRA packed little-endian, i.e. B | G << 8 | R << 16 | A << 24. */
  backgroundColor?: number;
}

const MAX_CANVAS_EDGE = 16384;
const MAX_FRAME_DURATION = 0xffffff;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[offset + i] ?? 0);
  return text;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeU24(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i) & 0xff;
}

function assertDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_CANVAS_EDGE) {
    throw new RangeError(`${label} 必须在 1..${MAX_CANVAS_EDGE} 之间，收到 ${value}`);
  }
}

/** Wraps a chunk payload with its FourCC, size and RIFF padding byte. */
export function riffChunk(type: string, data: Uint8Array): Uint8Array {
  if (type.length !== 4) throw new Error(`RIFF chunk type 必须是 4 字节: ${type}`);
  const size = data.length;
  const out = new Uint8Array(8 + size + (size & 1));
  writeAscii(out, 0, type);
  writeU32(out, 4, size);
  out.set(data, 8);
  return out;
}

function dimensionsFromImageChunks(chunks: WebpChunk[]): { width: number; height: number } {
  for (const chunk of chunks) {
    const data = chunk.data;
    if (chunk.type === 'VP8X' && data.length >= 10) {
      return {
        width: 1 + readU24(data, 4),
        height: 1 + readU24(data, 7),
      };
    }
    if (chunk.type === 'VP8L' && data.length >= 5 && data[0] === 0x2f) {
      const bits = data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      };
    }
    if (chunk.type === 'VP8 ' && data.length >= 10 && data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
      return {
        width: (data[6] | (data[7] << 8)) & 0x3fff,
        height: (data[8] | (data[9] << 8)) & 0x3fff,
      };
    }
  }
  return { width: 0, height: 0 };
}

/**
 * Parses a complete still WebP file. Tolerates unknown optional chunks and
 * reports zero dimensions if the payload is not a bitstream we recognise.
 */
export function parseStillWebp(input: Uint8Array | ArrayBuffer): ParsedStillWebp {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 12) throw new Error('WebP 文件过短');
  if (ascii(bytes, 0, 4) !== 'RIFF') throw new Error('缺少 RIFF 头');
  if (ascii(bytes, 8, 4) !== 'WEBP') throw new Error('缺少 WEBP 标识');

  const riffSize = readU32(bytes, 4);
  const declaredEnd = 8 + riffSize;
  const end = Math.min(bytes.length, declaredEnd);
  const chunks: WebpChunk[] = [];
  let offset = 12;

  while (offset + 8 <= end) {
    const type = ascii(bytes, offset, 4);
    const size = readU32(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > end) throw new Error(`WebP chunk ${type} 越界`);
    chunks.push({ type, data: bytes.subarray(dataStart, dataEnd) });
    offset = dataEnd + (size & 1);
  }

  // VP8L carries its own alpha plane inside the bitstream; ALPH only exists
  // for the lossy VP8 path.
  const hasAlpha =
    chunks.some((chunk) => chunk.type === 'ALPH') ||
    chunks.some((chunk) => chunk.type === 'VP8L');
  const dimensions = dimensionsFromImageChunks(chunks);
  return { width: dimensions.width, height: dimensions.height, hasAlpha, chunks };
}

/**
 * Extracts the payload chunks that may legally sit inside a single ANMF.
 * VP8L carries its own alpha and must be used alone; VP8 requires ALPH when
 * the still has an alpha plane.
 */
export function extractAnimationChunks(still: ParsedStillWebp): WebpChunk[] {
  const alpha = still.chunks.find((chunk) => chunk.type === 'ALPH');
  const lossy = still.chunks.find((chunk) => chunk.type === 'VP8 ');
  const lossless = still.chunks.find((chunk) => chunk.type === 'VP8L');

  if (lossless) {
    return [{ type: 'VP8L', data: lossless.data.slice() }];
  }
  if (lossy) {
    const result: WebpChunk[] = [];
    if (alpha) result.push({ type: 'ALPH', data: alpha.data.slice() });
    result.push({ type: 'VP8 ', data: lossy.data.slice() });
    return result;
  }
  throw new Error('WebP 静帧中找不到 VP8 / VP8L 图像数据');
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Full VP8X payload: flags 0x12 (alpha + animation), canvas size minus one. */
function vp8xPayload(width: number, height: number): Uint8Array {
  const data = new Uint8Array(10);
  data[0] = 0x12; // animation (0x02) + alpha (0x10)
  // data[1..3] reserved, must be zero.
  writeU24(data, 4, width - 1);
  writeU24(data, 7, height - 1);
  return data;
}

function animPayload(repeat: number, backgroundColor: number): Uint8Array {
  const data = new Uint8Array(6);
  writeU32(data, 0, backgroundColor >>> 0);
  writeU16(data, 4, repeat);
  return data;
}

function anmfChunk(
  width: number,
  height: number,
  frame: WebpAnimationFrame,
): Uint8Array {
  if (!Number.isInteger(frame.durationMs) || frame.durationMs < 0 || frame.durationMs > MAX_FRAME_DURATION) {
    throw new RangeError(`帧时长必须是 0..${MAX_FRAME_DURATION} 的整数毫秒`);
  }
  if (frame.chunks.length === 0) throw new Error('ANMF 帧没有图像子块');

  const header = new Uint8Array(16);
  // Every export frame covers the whole canvas, so x = y = 0.
  writeU24(header, 0, 0); // frame x / 2
  writeU24(header, 3, 0); // frame y / 2
  writeU24(header, 6, width - 1);
  writeU24(header, 9, height - 1);
  writeU24(header, 12, Math.round(frame.durationMs));
  // bit 1: do not blend; bit 0: dispose to background. Together they keep
  // every frame independent and preserve transparent pixels.
  header[15] = 0x03;

  const subChunks = frame.chunks.map((chunk) => riffChunk(chunk.type, chunk.data));
  return riffChunk('ANMF', concat([header, ...subChunks]));
}

/**
 * Builds a complete animated WebP file:
 * 'RIFF' size 'WEBP' VP8X ANIM ANMF...
 */
export function buildAnimatedWebp(options: WebpAnimationOptions): Uint8Array {
  const { width, height, frames } = options;
  assertDimension(width, '画布宽度');
  assertDimension(height, '画布高度');
  if (frames.length === 0) throw new Error('动画至少需要一帧');

  const repeat = options.repeat ?? 0;
  if (!Number.isInteger(repeat) || repeat < 0 || repeat > 0xffff) {
    throw new RangeError('循环次数必须是 0..65535 的整数（0 = 无限）');
  }
  const backgroundColor = options.backgroundColor ?? 0;

  const chunks: Uint8Array[] = [
    riffChunk('VP8X', vp8xPayload(width, height)),
    riffChunk('ANIM', animPayload(repeat, backgroundColor)),
    ...frames.map((frame) => anmfChunk(width, height, frame)),
  ];

  const total = 12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  writeAscii(out, 0, 'RIFF');
  writeU32(out, 4, total - 8);
  writeAscii(out, 8, 'WEBP');
  let offset = 12;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Inspects container-level fields; used by tests and the export checker. */
export interface WebpAnimationSummary {
  width: number;
  height: number;
  repeat: number;
  backgroundColor: number;
  frames: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    durationMs: number;
    flags: number;
    payloadTypes: string[];
  }>;
}

export function inspectAnimatedWebp(input: Uint8Array | ArrayBuffer): WebpAnimationSummary {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    throw new Error('不是 WebP RIFF 文件');
  }
  const end = Math.min(bytes.length, 8 + readU32(bytes, 4));
  let offset = 12;
  let width = 0;
  let height = 0;
  let repeat = 0;
  let backgroundColor = 0;
  const frames: WebpAnimationSummary['frames'] = [];

  while (offset + 8 <= end) {
    const type = ascii(bytes, offset, 4);
    const size = readU32(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > end) throw new Error(`chunk ${type} 越界`);
    const data = bytes.subarray(dataStart, dataEnd);

    if (type === 'VP8X' && size >= 10) {
      width = 1 + readU24(data, 4);
      height = 1 + readU24(data, 7);
    } else if (type === 'ANIM' && size >= 6) {
      backgroundColor = readU32(data, 0);
      repeat = readU16(data, 4);
    } else if (type === 'ANMF' && size >= 16) {
      let subOffset = 16;
      const payloadTypes: string[] = [];
      while (subOffset + 8 <= size) {
        const subType = ascii(data, subOffset, 4);
        const subSize = readU32(data, subOffset + 4);
        payloadTypes.push(subType);
        subOffset += 8 + subSize + (subSize & 1);
      }
      frames.push({
        x: readU24(data, 0) * 2,
        y: readU24(data, 3) * 2,
        width: 1 + readU24(data, 6),
        height: 1 + readU24(data, 9),
        durationMs: readU24(data, 12),
        flags: data[15] ?? 0,
        payloadTypes,
      });
    }

    offset = dataEnd + (size & 1);
  }

  return { width, height, repeat, backgroundColor, frames };
}
