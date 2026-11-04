import { Color, PerspectiveCamera } from 'three';
import type { Viewer } from '../scene/viewer';
import { GifFrameEncoder } from './gif-encode';
import type { ExportHooks, ExportOptions, ExportResult } from './types';
import { encodeStillWebp } from './webp-encode';
import { buildAnimatedWebp, type WebpAnimationFrame } from './webp-mux';

export interface ExportSessionDeps {
  viewer: Viewer;
  /** Current visible atoms + cell wireframe bounding radius, in cluster units. */
  fitRadius: number;
  /** Hide UI-only WebGL objects and set LineMaterial resolution. */
  prepare: (size: number, includePolyhedron: boolean) => void;
  /** Restore selection ring, labels, LineMaterial resolution. */
  restore: () => void;
}

function abortError(): DOMException {
  return new DOMException('导出已取消', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function macrotask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`无效的背景颜色: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/** WebP ANIM background is BGRA packed little-endian. */
function hexToBgra32(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

export function frameDurationsMs(totalFrames: number, fps: number): number[] {
  const durations: number[] = [];
  let previous = 0;
  for (let index = 0; index < totalFrames; index++) {
    const end = Math.round(((index + 1) * 1000) / fps);
    durations.push(end - previous);
    previous = end;
  }
  return durations;
}

/** Fits a sphere of `radius` into a square frame with a ~15% margin. */
export function exportCameraDistance(
  radius: number,
  fovDegrees: number,
  margin = 1.15,
): number {
  const halfFov = (fovDegrees * Math.PI) / 360;
  return (radius / Math.sin(halfFov)) * margin;
}

function makeExportCamera(viewer: Viewer): PerspectiveCamera {
  // A fresh square camera: no mobile viewOffset, no dependence on the screen
  // viewport. FOV and near/far match the live camera so lighting/framing read
  // identically; only distance and aspect are export-specific.
  const camera = new PerspectiveCamera(
    viewer.camera.fov,
    1,
    viewer.camera.near,
    viewer.camera.far,
  );
  camera.updateProjectionMatrix();
  return camera;
}

/**
 * Renders on the main WebGLRenderer (never a second context, so the PMREM
 * environment texture stays valid), turns the canvas into still frames,
 * encodes them, and restores every renderer/scene/camera setting in finally.
 */
export async function runExportSession(
  deps: ExportSessionDeps,
  options: ExportOptions,
  hooks: ExportHooks,
): Promise<ExportResult> {
  const totalFrames = Math.round(options.duration * options.fps);
  if (totalFrames < 1) throw new Error('导出至少需要一帧');
  const size = Math.round(options.size);
  const transparent = options.background === 'transparent';
  const clearColor = transparent ? new Color(0x000000) : new Color(options.backgroundColor);
  const clearAlpha = transparent ? 0 : 1;
  const backgroundColor = transparent ? 0 : hexToBgra32(options.backgroundColor);
  const durations = frameDurationsMs(totalFrames, options.fps);

  const camera = makeExportCamera(deps.viewer);
  const snapshot = deps.viewer.getCameraSnapshot();
  const phi = Math.max(0.2, Math.min(Math.PI - 0.2, snapshot.polar));
  const startTheta = snapshot.azimuth;
  const distance = exportCameraDistance(deps.fitRadius, deps.viewer.camera.fov);

  const gif = options.format === 'gif'
    ? new GifFrameEncoder(size, size, {
        transparent,
        repeat: options.repeat,
      })
    : null;
  const gifCanvas = gif ? document.createElement('canvas') : null;
  if (gifCanvas) {
    gifCanvas.width = size;
    gifCanvas.height = size;
  }
  const gifContext = gifCanvas?.getContext('2d', { willReadFrequently: true }) ?? null;
  if (gif && gifContext === null) throw new Error('无法创建 GIF 采样用的 2D canvas');

  const webpFrames: WebpAnimationFrame[] = [];
  const encoders = new Set<'native' | 'jsquash' | 'gifenc'>();
  if (gif) encoders.add('gifenc');

  hooks.onProgress({
    stage: 'prepare',
    frame: 0,
    totalFrames,
    encoder: gif ? 'gifenc' : null,
    label: `准备 ${size}×${size} 画布`,
  });

  let prepared = false;
  let rendererBegun = false;

  try {
    deps.prepare(size, options.includePolyhedron);
    prepared = true;
    deps.viewer.beginExport(size, clearColor, clearAlpha);
    rendererBegun = true;

    // The first frame at the new drawing-buffer size can trigger expensive
    // SwiftShader pipeline work; yield so the progress UI is interactive.
    await macrotask();

    for (let index = 0; index < totalFrames; index++) {
      throwIfAborted(hooks.signal);
      const theta = startTheta + (Math.PI * 2 * index) / totalFrames;
      camera.position.setFromSphericalCoords(distance, phi, theta);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      hooks.onProgress({
        stage: 'render',
        frame: index + 1,
        totalFrames,
        encoder: gif ? 'gifenc' : null,
        label: `渲染 ${index + 1}/${totalFrames}`,
      });

      deps.viewer.renderer.render(deps.viewer.scene, camera);
      throwIfAborted(hooks.signal);

      hooks.onProgress({
        stage: 'encode',
        frame: index + 1,
        totalFrames,
        encoder: gif ? 'gifenc' : null,
        label: `编码 ${options.format === 'webp' ? 'WebP' : 'GIF'} ${index + 1}/${totalFrames}`,
      });

      if (gif) {
        if (!gifContext) throw new Error('GIF 2D 上下文不可用');
        gifContext.clearRect(0, 0, size, size);
        gifContext.drawImage(deps.viewer.renderer.domElement, 0, 0, size, size);
        const imageData = gifContext.getImageData(0, 0, size, size);
        gif.addFrame(imageData, options.fps);
      } else {
        const still = await encodeStillWebp(
          deps.viewer.renderer.domElement,
          options.quality,
          transparent,
        );
        encoders.add(still.encoder);
        webpFrames.push({ chunks: still.chunks, durationMs: durations[index] ?? durations[0] });
      }

      throwIfAborted(hooks.signal);
      await macrotask();
    }

    throwIfAborted(hooks.signal);

    if (gif) {
      hooks.onProgress({
        stage: 'mux',
        frame: totalFrames,
        totalFrames,
        encoder: 'gifenc',
        label: '生成 GIF 文件',
      });
      const { bytes, frames } = gif.finish();
      await macrotask();
      throwIfAborted(hooks.signal);
      const blob = new Blob([blobPart(bytes)], { type: 'image/gif' });
      hooks.onProgress({
        stage: 'done',
        frame: frames,
        totalFrames: frames,
        encoder: 'gifenc',
        label: 'GIF 导出完成',
      });
      return {
        blob,
        format: 'gif',
        width: size,
        height: size,
        frames,
        durationMs: durations.reduce((sum, value) => sum + value, 0),
        sizeBytes: blob.size,
        encoder: 'gifenc',
      };
    }

    hooks.onProgress({
      stage: 'mux',
      frame: totalFrames,
      totalFrames,
      encoder: encoders.has('jsquash') ? 'jsquash' : 'native',
      label: '封装 WebP 动画容器',
    });
    const bytes = buildAnimatedWebp({
      width: size,
      height: size,
      frames: webpFrames,
      repeat: options.repeat,
      backgroundColor,
    });
    await macrotask();
    throwIfAborted(hooks.signal);
    const blob = new Blob([blobPart(bytes)], { type: 'image/webp' });
    const encoder = encoders.has('jsquash') ? 'jsquash' : 'native';
    hooks.onProgress({
      stage: 'done',
      frame: totalFrames,
      totalFrames,
      encoder,
      label: 'WebP 导出完成',
    });
    return {
      blob,
      format: 'webp',
      width: size,
      height: size,
      frames: totalFrames,
      durationMs: durations.reduce((sum, value) => sum + value, 0),
      sizeBytes: blob.size,
      encoder,
    };
  } finally {
    if (rendererBegun) {
      try {
        deps.viewer.endExport();
      } catch {
        // A failed restore should not hide the original export error.
      }
    }
    if (prepared) {
      try {
        deps.restore();
      } catch {
        // Same: restore is best-effort, but the rendering state must be reset.
      }
    }
  }
}
