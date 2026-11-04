import { GIFEncoder, applyPalette, quantize, type GifPalette } from 'gifenc';

/**
 * GIF is 8-bit palettised and only has 1-bit alpha. Every frame gets its own
 * palette (local colour table) so the transparent background stays index 0
 * while the gold atoms keep a reasonable colour spread.
 */

export interface GifOptions {
  transparent: boolean;
  /** 0 = infinite, 1 = one loop (gifenc: -1 once, 0 forever, >0 count). */
  repeat: number;
}

/**
 * Cumulative centisecond schedule. At 30 fps this alternates 30/40 ms and
 * keeps the total duration exact instead of drifting by 3 ms per frame.
 * GIF players clamp delays below 20 ms, so that is the hard floor.
 */
export function gifDelayCentiseconds(frameIndex: number, fps: number): number {
  const previous = Math.round((frameIndex * 1000) / fps / 10);
  const next = Math.round(((frameIndex + 1) * 1000) / fps / 10);
  return Math.max(2, next - previous);
}

/** Copies RGBA, snapping alpha to one bit and zeroing hidden RGB. */
export function prepareOneBitAlpha(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if ((rgba[offset + 3] ?? 0) < 128) {
      out[offset] = 0;
      out[offset + 1] = 0;
      out[offset + 2] = 0;
      out[offset + 3] = 0;
    } else {
      out[offset] = rgba[offset] ?? 0;
      out[offset + 1] = rgba[offset + 1] ?? 0;
      out[offset + 2] = rgba[offset + 2] ?? 0;
      out[offset + 3] = 255;
    }
  }
  return out;
}

export interface QuantizedGifFrame {
  palette: GifPalette;
  index: Uint8Array;
}

export function quantizeGifFrame(
  rgba: Uint8ClampedArray,
  transparent: boolean,
): QuantizedGifFrame {
  if (transparent) {
    const cleaned = prepareOneBitAlpha(rgba);
    // Reserve one slot for the transparent index. quantize may still return
    // an alpha=0 entry, which is removed before we prepend our own.
    const raw = quantize(cleaned, 255, { format: 'rgba4444', oneBitAlpha: true });
    const opaque = raw.filter((entry) => (entry[3] ?? 0) > 0);
    const palette: GifPalette = [[0, 0, 0, 0], ...opaque].slice(0, 256);
    const index = applyPalette(cleaned, palette, 'rgba4444');
    for (let i = 0; i < index.length; i++) {
      if ((cleaned[i * 4 + 3] ?? 0) < 128) {
        index[i] = 0;
      } else if (index[i] === 0) {
        // An opaque pixel must never borrow the transparent index.
        index[i] = Math.min(1, palette.length - 1);
      }
    }
    return { palette, index };
  }

  const ok = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true });
  const palette: GifPalette = ok.filter((entry) => (entry[3] ?? 0) > 0);
  if (palette.length === 0) palette.push([0, 0, 0, 255]);
  const index = applyPalette(rgba, palette, 'rgba4444');
  return { palette, index };
}

/**
 * Streams frames into one GIFEncoder. Frames are quantized and written one at
 * a time, so a 1440px / 5s export never holds every index buffer in memory.
 */
export class GifFrameEncoder {
  private readonly encoder = GIFEncoder();
  private frameCount = 0;
  private finished = false;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly options: GifOptions,
  ) {}

  addFrame(imageData: ImageData, fps: number): void {
    if (this.finished) throw new Error('GIF 编码器已结束');
    const { palette, index } = quantizeGifFrame(imageData.data, this.options.transparent);
    const delayCs = gifDelayCentiseconds(this.frameCount, fps);
    this.encoder.writeFrame(index, this.width, this.height, {
      palette,
      transparent: this.options.transparent,
      transparentIndex: 0,
      delay: delayCs * 10,
      repeat: this.frameCount === 0 ? this.options.repeat : 0,
      dispose: 2,
    });
    this.frameCount++;
  }

  finish(): { bytes: Uint8Array; frames: number } {
    if (this.finished) throw new Error('GIF 编码器已结束');
    this.finished = true;
    this.encoder.finish();
    return { bytes: this.encoder.bytes(), frames: this.frameCount };
  }

  get frames(): number {
    return this.frameCount;
  }
}
