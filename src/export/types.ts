export type ExportFormat = 'webp' | 'gif';
export type ExportBackground = 'transparent' | 'solid';

export interface ExportOptions {
  format: ExportFormat;
  /** Square output edge in CSS pixels (device pixel ratio is forced to 1). */
  size: number;
  /** Loop duration in seconds. */
  duration: number;
  fps: number;
  background: ExportBackground;
  backgroundColor: string;
  /** WebP quality, 1-100. Ignored by GIF. */
  quality: number;
  /** 0 = forever; 1 = play the loop count once. */
  repeat: number;
  /** Include the selected site's coordination polyhedron (never the target ring). */
  includePolyhedron: boolean;
}

export type ExportStage = 'prepare' | 'render' | 'encode' | 'mux' | 'done';

export interface ExportProgress {
  stage: ExportStage;
  frame: number;
  totalFrames: number;
  encoder: 'native' | 'jsquash' | 'gifenc' | null;
  /** Human-readable Chinese status line. */
  label: string;
}

export interface ExportResult {
  blob: Blob;
  format: ExportFormat;
  width: number;
  height: number;
  frames: number;
  durationMs: number;
  sizeBytes: number;
  encoder: 'native' | 'jsquash' | 'gifenc';
}

export interface ExportHooks {
  signal: AbortSignal;
  onProgress: (progress: ExportProgress) => void;
}

export const EXPORT_SIZES = [540, 720, 1080, 1440] as const;
export const EXPORT_DURATIONS = [1, 2, 3, 4, 5] as const;
export const EXPORT_FPS = [24, 30] as const;
export const DEFAULT_EXPORT_OPTIONS: Omit<ExportOptions, 'includePolyhedron'> = {
  format: 'webp',
  size: 1080,
  duration: 3,
  fps: 30,
  background: 'transparent',
  backgroundColor: '#061A33',
  quality: 92,
  repeat: 0,
};

export function exportExtension(format: ExportFormat): 'webp' | 'gif' {
  return format;
}

export function exportMime(format: ExportFormat): string {
  return format === 'webp' ? 'image/webp' : 'image/gif';
}
