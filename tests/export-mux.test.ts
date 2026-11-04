import { describe, expect, it } from 'vitest';
import { gifDelayCentiseconds, prepareOneBitAlpha } from '../src/export/gif-encode';
import { frameDurationsMs } from '../src/export/session';
import {
  buildAnimatedWebp,
  extractAnimationChunks,
  inspectAnimatedWebp,
  parseStillWebp,
  riffChunk,
} from '../src/export/webp-mux';

function stillWebp(options: {
  width: number;
  height: number;
  alpha?: Uint8Array;
  lossless?: boolean;
  extra?: Uint8Array[];
}): Uint8Array {
  const { width, height, alpha, lossless = false, extra = [] } = options;
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x12;
  vp8x[4] = (width - 1) & 0xff;
  vp8x[5] = ((width - 1) >>> 8) & 0xff;
  vp8x[6] = ((width - 1) >>> 16) & 0xff;
  vp8x[7] = (height - 1) & 0xff;
  vp8x[8] = ((height - 1) >>> 8) & 0xff;
  vp8x[9] = ((height - 1) >>> 16) & 0xff;

  const image = lossless
    ? new Uint8Array([0x2f, 0x01, 0x00, 0x00, 0x00, 0xaa])
    : new Uint8Array([1, 2, 3, 0x9d, 0x01, 0x2a, width & 0xff, 0, height & 0xff, 0, 9]);
  const chunks = [
    riffChunk('VP8X', vp8x),
    ...(alpha ? [riffChunk('ALPH', alpha)] : []),
    riffChunk(lossless ? 'VP8L' : 'VP8 ', image),
    ...extra,
  ];
  const total = 12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  out[4] = (total - 8) & 0xff;
  out[5] = ((total - 8) >>> 8) & 0xff;
  out[6] = ((total - 8) >>> 16) & 0xff;
  out[7] = ((total - 8) >>> 24) & 0xff;
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  let offset = 12;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe('WebP still parsing', () => {
  it('reads VP8X dimensions and ALPH presence', () => {
    const bytes = stillWebp({ width: 540, height: 540, alpha: new Uint8Array([1, 2, 3]) });
    const still = parseStillWebp(bytes);
    expect(still.width).toBe(540);
    expect(still.height).toBe(540);
    expect(still.hasAlpha).toBe(true);
    expect(still.chunks.map((chunk) => chunk.type)).toEqual(['VP8X', 'ALPH', 'VP8 ']);
  });

  it('extracts ALPH before VP8 and never keeps ALPH with VP8L', () => {
    const lossy = parseStillWebp(
      stillWebp({ width: 32, height: 32, alpha: new Uint8Array([7, 8, 9]) }),
    );
    expect(extractAnimationChunks(lossy).map((chunk) => chunk.type)).toEqual(['ALPH', 'VP8 ']);

    const lossless = parseStillWebp(
      stillWebp({ width: 32, height: 32, alpha: new Uint8Array([7]), lossless: true }),
    );
    expect(extractAnimationChunks(lossless).map((chunk) => chunk.type)).toEqual(['VP8L']);
  });

  it('rejects a truncated chunk', () => {
    const bytes = stillWebp({ width: 32, height: 32 });
    bytes[16] = 0xff;
    bytes[17] = 0xff;
    expect(() => parseStillWebp(bytes)).toThrow();
  });
});

describe('animated WebP muxer', () => {
  const frameChunks = (seed: number) => [
    { type: 'ALPH', data: new Uint8Array([seed, 0, 0]) },
    { type: 'VP8 ', data: new Uint8Array([seed, 1, 2, 3, 4]) },
  ];

  it('writes VP8X / ANIM / ANMF with the expected fields and padding', () => {
    const bytes = buildAnimatedWebp({
      width: 540,
      height: 540,
      repeat: 0,
      backgroundColor: 0,
      frames: [
        { chunks: frameChunks(1), durationMs: 33 },
        { chunks: frameChunks(2), durationMs: 34 },
      ],
    });
    const summary = inspectAnimatedWebp(bytes);
    expect(summary.width).toBe(540);
    expect(summary.height).toBe(540);
    expect(summary.repeat).toBe(0);
    expect(summary.backgroundColor).toBe(0);
    expect(summary.frames).toHaveLength(2);
    expect(summary.frames[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 540,
      height: 540,
      durationMs: 33,
      flags: 3,
      payloadTypes: ['ALPH', 'VP8 '],
    });
    expect(summary.frames[1]?.durationMs).toBe(34);

    // RIFF size excludes the 8-byte header; every chunk is even-sized.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(bytes.length % 2).toBe(0);
    expect(bytes[0]).toBe(0x52);
  });

  it('uses the ANIM background for solid exports and preserves loop count', () => {
    const bytes = buildAnimatedWebp({
      width: 8,
      height: 8,
      repeat: 1,
      backgroundColor: 0xff061a33,
      frames: [{ chunks: frameChunks(3), durationMs: 40 }],
    });
    const summary = inspectAnimatedWebp(bytes);
    expect(summary.repeat).toBe(1);
    expect(summary.backgroundColor).toBe(0xff061a33);
    expect(summary.frames[0]?.flags).toBe(3);
  });

  it('rejects empty animations and invalid durations', () => {
    expect(() =>
      buildAnimatedWebp({ width: 8, height: 8, frames: [] }),
    ).toThrow();
    expect(() =>
      buildAnimatedWebp({
        width: 8,
        height: 8,
        frames: [{ chunks: frameChunks(1), durationMs: 0x1000000 }],
      }),
    ).toThrow();
  });
});

describe('frame timing', () => {
  it('keeps WebP total duration exact at 30 fps', () => {
    const durations = frameDurationsMs(90, 30);
    expect(durations).toHaveLength(90);
    expect(durations.reduce((sum, value) => sum + value, 0)).toBe(3000);
    expect(durations.slice(0, 4)).toEqual([33, 34, 33, 33]);
  });

  it('alternates 30/40 ms GIF delays and enforces the 20 ms floor', () => {
    const values = Array.from({ length: 10 }, (_, index) => gifDelayCentiseconds(index, 30));
    expect(values.slice(0, 6)).toEqual([3, 4, 3, 3, 4, 3]);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(2);
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(33);
  });
});

describe('GIF alpha preparation', () => {
  it('snaps alpha and zeros hidden RGB', () => {
    const rgba = new Uint8ClampedArray([
      10, 20, 30, 0,
      40, 50, 60, 127,
      70, 80, 90, 128,
      100, 110, 120, 255,
    ]);
    const out = prepareOneBitAlpha(rgba);
    expect(Array.from(out)).toEqual([
      0, 0, 0, 0,
      0, 0, 0, 0,
      70, 80, 90, 255,
      100, 110, 120, 255,
    ]);
  });
});
