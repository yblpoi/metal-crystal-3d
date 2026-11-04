import webpEncWasm from '@jsquash/webp/codec/enc/webp_enc.wasm?url';
import webpEncSimdWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url';
import { extractAnimationChunks, parseStillWebp, type WebpChunk } from './webp-mux';

declare global {
  interface Window {
    __CRYSTAL_FORCE_WEBP_FALLBACK__?: boolean;
  }
}

export interface EncodedWebpStill {
  chunks: WebpChunk[];
  width: number;
  height: number;
  hasAlpha: boolean;
  encoder: 'native' | 'jsquash';
}

type JsquashEncode = typeof import('@jsquash/webp/encode.js')['default'];
let jsquashEncoder: Promise<JsquashEncode> | null = null;

/**
 * The wasm module is expensive to compile. Cache both the module promise and
 * the initialized Emscripten instance across all frames.
 */
function loadJsquashEncoder(): Promise<JsquashEncode> {
  if (!jsquashEncoder) {
    jsquashEncoder = (async () => {
      const module = await import('@jsquash/webp/encode.js');
      await module.init({
        locateFile: (file: string) =>
          file.includes('simd') ? webpEncSimdWasm : webpEncWasm,
      });
      return module.default;
    })().catch((error) => {
      jsquashEncoder = null;
      throw error;
    });
  }
  return jsquashEncoder;
}

export function isWebpFallbackForced(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__CRYSTAL_FORCE_WEBP_FALLBACK__ === true) return true;
  try {
    return new URLSearchParams(window.location.search).get('forceWebpFallback') === '1';
  } catch {
    return false;
  }
}

function nativeToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/webp', quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Browser-native encoding is preferred: it is fast, already alpha-aware and
 * produces exactly the still WebP layout the muxer expects. Safari and older
 * browsers can return a PNG (or null) from toBlob('image/webp'), so the MIME
 * type is verified rather than trusted.
 */
async function encodeNative(
  canvas: HTMLCanvasElement,
  quality: number,
  requireAlpha: boolean,
): Promise<EncodedWebpStill | null> {
  const blob = await nativeToBlob(canvas, quality);
  if (!blob || blob.type !== 'image/webp' || blob.size < 32) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const still = parseStillWebp(bytes);
  if (still.width !== canvas.width || still.height !== canvas.height) return null;
  if (requireAlpha && !still.hasAlpha) return null;
  return {
    chunks: extractAnimationChunks(still),
    width: still.width,
    height: still.height,
    hasAlpha: still.hasAlpha,
    encoder: 'native',
  };
}

function drawToImageData(canvas: HTMLCanvasElement): ImageData {
  const scratch = document.createElement('canvas');
  scratch.width = canvas.width;
  scratch.height = canvas.height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建 2D canvas 上下文');
  context.clearRect(0, 0, scratch.width, scratch.height);
  context.drawImage(canvas, 0, 0);
  return context.getImageData(0, 0, scratch.width, scratch.height);
}

/**
 * WASM fallback for browsers without canvas WebP encoding. Dynamically
 * imported so the ~300 KB wasm payload never enters the first screen.
 */
async function encodeWithJsquash(
  canvas: HTMLCanvasElement,
  quality: number,
  requireAlpha: boolean,
): Promise<EncodedWebpStill> {
  const imageData = drawToImageData(canvas);
  // Vite's dependency pre-bundler rewrites the package's relative
  // new URL('webp_enc.wasm', import.meta.url) incorrectly in dev. Supplying
  // the assets through ?url makes the wasm location explicit in dev and build.
  const encode = await loadJsquashEncoder();
  const buffer = await encode(imageData, {
    quality: Math.round(quality),
    alpha_quality: 100,
    lossless: 0,
    exact: 1,
  });
  const still = parseStillWebp(new Uint8Array(buffer));
  if (still.width !== canvas.width || still.height !== canvas.height) {
    throw new Error(
      `@jsquash/webp 输出尺寸 ${still.width}×${still.height}，期望 ${canvas.width}×${canvas.height}`,
    );
  }
  if (requireAlpha && !still.hasAlpha) {
    throw new Error('@jsquash/webp 输出未包含 alpha 通道');
  }
  return {
    chunks: extractAnimationChunks(still),
    width: still.width,
    height: still.height,
    hasAlpha: still.hasAlpha,
    encoder: 'jsquash',
  };
}

export async function encodeStillWebp(
  canvas: HTMLCanvasElement,
  quality: number,
  requireAlpha: boolean,
  forceFallback = isWebpFallbackForced(),
): Promise<EncodedWebpStill> {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  let nativeError: unknown = null;

  if (!forceFallback) {
    try {
      const native = await encodeNative(canvas, q / 100, requireAlpha);
      if (native) return native;
      nativeError = new Error(
        requireAlpha ? '浏览器原生 WebP 编码不可用或丢失 alpha' : '浏览器原生 WebP 编码不可用',
      );
    } catch (error) {
      nativeError = error;
    }
  }

  try {
    return await encodeWithJsquash(canvas, q, requireAlpha);
  } catch (fallbackError) {
    const nativeMessage = nativeError instanceof Error ? nativeError.message : '原生编码从未执行';
    const fallbackMessage =
      fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    throw new Error(
      `WebP 编码失败：原生 canvas（${nativeMessage}）与 @jsquash/webp fallback（${fallbackMessage}）均不可用。请改用 GIF 导出。`,
    );
  }
}
