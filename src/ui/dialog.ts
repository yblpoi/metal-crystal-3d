import type { StructureId } from '../crystal/types';
import type {
  ExportHooks,
  ExportOptions,
  ExportProgress,
  ExportResult,
} from '../export/types';
import { exportExtension } from '../export/types';

export interface ExportSelectionInfo {
  available: boolean;
  label: string;
}

export interface ExportDialogCallbacks {
  start(options: ExportOptions, hooks: ExportHooks): Promise<ExportResult>;
  getStructureId(): StructureId;
  getSelectionInfo(): ExportSelectionInfo;
}

type Mode = 'idle' | 'running' | 'done' | 'error';

const QUALITY_MIN = 70;
const QUALITY_MAX = 100;

export class ExportDialog {
  private readonly dialog = must<HTMLDialogElement>('export-dialog');
  private readonly optionsField = must<HTMLFieldSetElement>('export-options');
  private readonly closeButton = must<HTMLButtonElement>('export-close');
  private readonly cancelButton = must<HTMLButtonElement>('export-cancel');
  private readonly startButton = must<HTMLButtonElement>('export-start');
  private readonly downloadButton = must<HTMLButtonElement>('export-download');
  private readonly againButton = must<HTMLButtonElement>('export-again');

  private readonly formatWebp = must<HTMLInputElement>('export-format-webp');
  private readonly formatGif = must<HTMLInputElement>('export-format-gif');
  private readonly sizeSelect = must<HTMLSelectElement>('export-size');
  private readonly durationSelect = must<HTMLSelectElement>('export-duration');
  private readonly fpsSelect = must<HTMLSelectElement>('export-fps');
  private readonly loopSelect = must<HTMLSelectElement>('export-loop');
  private readonly qualityRow = must<HTMLElement>('export-quality-row');
  private readonly qualityInput = must<HTMLInputElement>('export-quality');
  private readonly qualityOutput = must<HTMLOutputElement>('export-quality-out');
  private readonly bgTransparent = must<HTMLInputElement>('export-bg-transparent');
  private readonly bgSolid = must<HTMLInputElement>('export-bg-solid');
  private readonly bgColor = must<HTMLInputElement>('export-bg-color');
  private readonly bgHex = must<HTMLElement>('export-bg-hex');
  private readonly includePoly = must<HTMLInputElement>('export-include-poly');
  private readonly selectionNote = must<HTMLElement>('export-selection-note');
  private readonly gifNote = must<HTMLElement>('export-gif-note');
  private readonly formatNote = must<HTMLElement>('export-format-note');

  private readonly outputSize = must<HTMLElement>('export-output-size');
  private readonly framesEstimate = must<HTMLElement>('export-frames-estimate');
  private readonly durationEstimate = must<HTMLElement>('export-duration-estimate');
  private readonly encoderEstimate = must<HTMLElement>('export-encoder-estimate');

  private readonly progress = must<HTMLElement>('export-progress');
  private readonly progressLabel = must<HTMLElement>('export-progress-label');
  private readonly progressCount = must<HTMLElement>('export-progress-count');
  private readonly progressBar = must<HTMLProgressElement>('export-progress-bar');
  private readonly result = must<HTMLElement>('export-result');
  private readonly preview = must<HTMLImageElement>('export-preview');
  private readonly resultDimensions = must<HTMLElement>('export-result-dimensions');
  private readonly resultFrames = must<HTMLElement>('export-result-frames');
  private readonly resultSize = must<HTMLElement>('export-result-size');
  private readonly resultEncoder = must<HTMLElement>('export-result-encoder');
  private readonly resultNote = must<HTMLElement>('export-result-note');
  private readonly errorBox = must<HTMLElement>('export-error');

  private mode: Mode = 'idle';
  private controller: AbortController | null = null;
  private closeAfterCancel = false;
  private resultUrl: string | null = null;
  private lastResult: ExportResult | null = null;
  private lastOptions: ExportOptions | null = null;

  constructor(private readonly callbacks: ExportDialogCallbacks) {
    must<HTMLButtonElement>('export-btn').addEventListener('click', () => this.open());
    this.closeButton.addEventListener('click', () => this.requestClose());
    this.cancelButton.addEventListener('click', () => {
      // During an export the footer button cancels but keeps the dialog open,
      // so the user can adjust options and retry. The header close button (and
      // Esc/backdrop) cancels and then closes.
      if (this.mode === 'running') this.requestCancel();
      else this.requestClose();
    });
    this.startButton.addEventListener('click', () => void this.begin());
    this.downloadButton.addEventListener('click', () => this.download());
    this.againButton.addEventListener('click', () => this.resetToForm());

    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.requestClose();
    });
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.requestClose();
    });
    this.dialog.addEventListener('close', () => this.revokeResult());

    for (const input of [this.formatWebp, this.formatGif]) {
      input.addEventListener('change', () => this.render());
    }
    for (const control of [
      this.sizeSelect,
      this.durationSelect,
      this.fpsSelect,
      this.loopSelect,
    ]) {
      control.addEventListener('change', () => this.render());
    }
    this.qualityInput.addEventListener('input', () => this.render());
    for (const input of [this.bgTransparent, this.bgSolid]) {
      input.addEventListener('change', () => this.render());
    }
    this.bgColor.addEventListener('input', () => {
      this.bgHex.textContent = this.bgColor.value.toUpperCase();
      this.render();
    });
    this.includePoly.addEventListener('change', () => this.render());
    this.progressLabel.setAttribute('aria-live', 'polite');
  }

  open(): void {
    if (this.dialog.open) return;
    this.resetToForm();
    this.updateSelectionAvailability();
    this.dialog.showModal();
    this.updateSelectionAvailability();
    this.render();
    const body = this.dialog.querySelector<HTMLElement>('.dialog-body');
    body?.scrollTo({ top: 0 });
    // Keep focus inside the dialog but at the top option, not the footer, so
    // mobile users do not open the sheet already scrolled past the form.
    window.requestAnimationFrame(() => this.formatWebp.focus({ preventScroll: true }));
  }

  close(): void {
    this.requestClose();
  }

  isOpen(): boolean {
    return this.dialog.open;
  }

  isRunning(): boolean {
    return this.mode === 'running';
  }

  getLastResult(): ExportResult | null {
    return this.lastResult;
  }

  private updateSelectionAvailability(): void {
    const info = this.callbacks.getSelectionInfo();
    this.includePoly.disabled = !info.available;
    if (!info.available) this.includePoly.checked = false;
    this.selectionNote.textContent = info.available
      ? `当前选中：${info.label}。勾选后导出其配位多面体；选中目标环与标签始终不导出。`
      : '当前未选中完整配位位点，导出仅包含原子、间隙球与晶胞线框。';
  }

  private format(): 'webp' | 'gif' {
    return this.formatGif.checked ? 'gif' : 'webp';
  }

  private background(): 'transparent' | 'solid' {
    return this.bgSolid.checked ? 'solid' : 'transparent';
  }

  private readOptions(): ExportOptions {
    const format = this.format();
    const quality = Math.max(
      QUALITY_MIN,
      Math.min(QUALITY_MAX, Number.parseInt(this.qualityInput.value, 10) || 92),
    );
    return {
      format,
      size: Number.parseInt(this.sizeSelect.value, 10),
      duration: Number.parseInt(this.durationSelect.value, 10),
      fps: Number.parseInt(this.fpsSelect.value, 10),
      background: this.background(),
      backgroundColor: this.bgColor.value.toUpperCase(),
      quality,
      repeat: Number.parseInt(this.loopSelect.value, 10),
      includePolyhedron: this.includePoly.checked,
    };
  }

  private render(): void {
    const format = this.format();
    const solid = this.background() === 'solid';
    const options = this.readOptions();

    this.qualityRow.hidden = format === 'gif';
    this.qualityOutput.value = String(options.quality);
    this.bgColor.disabled = !solid;
    this.bgHex.textContent = options.backgroundColor;
    this.gifNote.hidden = !(format === 'gif' && !solid);

    for (const card of Array.from(this.dialog.querySelectorAll<HTMLElement>('.export-format-card'))) {
      const input = card.querySelector<HTMLInputElement>('input');
      card.classList.toggle('is-selected', Boolean(input?.checked));
    }

    const frames = options.duration * options.fps;
    this.outputSize.textContent = `${options.size} × ${options.size}`;
    this.framesEstimate.textContent = String(frames);
    this.durationEstimate.textContent = `${options.duration.toFixed(1)} s`;
    this.encoderEstimate.textContent =
      format === 'webp' ? `WebP · q${options.quality}` : 'GIF · 256 色';

    this.formatNote.textContent =
      format === 'webp'
        ? '透明 WebP 使用 VP8X + ANIM + ANMF 容器，逐帧独立透明；Safari 等无原生 WebP 编码时自动使用 @jsquash/webp。'
        : 'GIF 使用 gifenc 逐帧量化，透明索引固定为 0；1-bit alpha 只保留全透明/不透明两种边缘。';
    this.updateSelectionAvailability();
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    const running = mode === 'running';
    this.optionsField.disabled = running || mode === 'done';
    this.dialog.classList.toggle('is-result', mode === 'done');
    this.dialog.setAttribute('aria-busy', String(running));
    this.startButton.hidden = running || mode === 'done';
    this.downloadButton.hidden = mode !== 'done';
    this.againButton.hidden = mode !== 'done';
    this.cancelButton.textContent = running ? '取消导出' : '关闭';
    this.againButton.textContent = '重新导出';
    this.closeButton.setAttribute(
      'aria-label',
      running ? '关闭并取消导出' : '关闭导出弹窗',
    );
    if (mode !== 'error') {
      this.errorBox.hidden = true;
      this.errorBox.classList.remove('is-info');
    }
    if (mode === 'idle') {
      this.progress.hidden = true;
      this.result.hidden = true;
      this.startButton.textContent = '开始导出';
      this.cancelButton.disabled = false;
    }
  }

  private resetToForm(): void {
    this.revokeResult();
    this.controller = null;
    this.closeAfterCancel = false;
    this.lastResult = null;
    this.progress.hidden = true;
    this.result.hidden = true;
    this.progressBar.value = 0;
    this.progressCount.textContent = '0 / 0';
    this.progressLabel.textContent = '准备导出';
    this.preview.removeAttribute('src');
    this.errorBox.hidden = true;
    this.errorBox.textContent = '';
    this.errorBox.classList.remove('is-info');
    this.errorBox.removeAttribute('tabindex');
    this.setMode('idle');
  }

  private async begin(): Promise<void> {
    if (this.mode === 'running') return;
    const options = this.readOptions();
    if (!Number.isFinite(options.size) || options.size < 1) {
      this.showError('导出尺寸无效，请重新选择。');
      return;
    }
    this.lastOptions = options;
    this.lastResult = null;
    this.revokeResult();
    this.errorBox.hidden = true;
    this.progress.hidden = false;
    this.result.hidden = true;
    this.progressBar.value = 0;
    this.progressCount.textContent = `0 / ${options.duration * options.fps}`;
    this.progressLabel.textContent = '准备导出';
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.setMode('running');
    // Let the browser paint the progress panel and let the click event finish
    // before the first WebGL render, which can be expensive on software GL.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    let succeeded = false;
    let closeRequested = false;

    try {
      const result = await this.callbacks.start(options, {
        signal,
        onProgress: (progress) => this.onProgress(progress, options),
      });
      if (signal.aborted || this.closeAfterCancel) {
        closeRequested = this.closeAfterCancel;
        this.resetToForm();
        return;
      }
      this.showResult(result, options);
      succeeded = true;
    } catch (error) {
      closeRequested = this.closeAfterCancel;
      if (signal.aborted) {
        this.resetToForm();
        if (!closeRequested) {
          this.showInfo('已取消导出，场景与视图已恢复。');
        }
      } else {
        this.setMode('error');
        this.progress.hidden = true;
        this.result.hidden = true;
        this.startButton.hidden = false;
        this.startButton.textContent = '重试导出';
        this.downloadButton.hidden = true;
        this.againButton.hidden = true;
        this.cancelButton.textContent = '关闭';
        this.cancelButton.disabled = false;
        this.showError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.controller = null;
      if (closeRequested && !succeeded) {
        this.closeAfterCancel = false;
        this.closeNow();
      }
    }
  }

  private onProgress(progress: ExportProgress, options: ExportOptions): void {
    const total = Math.max(1, progress.totalFrames);
    let ratio: number;
    if (progress.stage === 'done') ratio = 1;
    else if (progress.stage === 'mux') ratio = 0.98;
    else if (progress.stage === 'encode') ratio = progress.frame / total;
    else if (progress.stage === 'render') ratio = Math.max(0, (progress.frame - 1) / total);
    else ratio = 0;

    this.progressBar.value = Math.round(ratio * 100);
    this.progressLabel.textContent = progress.label;
    const frame = progress.stage === 'prepare' ? 0 : Math.min(progress.frame, total);
    this.progressCount.textContent = `${frame} / ${total}`;
    if (progress.stage === 'done') {
      this.progressLabel.textContent = `${options.format === 'webp' ? 'WebP' : 'GIF'} 导出完成，正在准备预览`;
    }
  }

  private showResult(result: ExportResult, options: ExportOptions): void {
    this.lastResult = result;
    this.resultUrl = URL.createObjectURL(result.blob);
    this.preview.src = this.resultUrl;
    this.preview.alt = `${result.format.toUpperCase()} 导出预览：${result.width}×${result.height}，${result.frames} 帧`;
    this.resultDimensions.textContent = `${result.width} × ${result.height}`;
    this.resultFrames.textContent = `${result.frames} 帧 · ${(result.durationMs / 1000).toFixed(1)} s`;
    this.resultSize.textContent = formatBytes(result.sizeBytes);
    this.resultEncoder.textContent =
      result.encoder === 'native'
        ? '浏览器原生 WebP'
        : result.encoder === 'jsquash'
          ? '@jsquash/webp fallback'
          : 'gifenc';
    this.resultNote.textContent =
      options.format === 'gif' && options.background === 'transparent'
        ? '预览以棋盘格表示透明区域。GIF 只有 1-bit alpha，透明边缘的锯齿是格式限制；需要平滑边缘请改用 WebP。'
        : '预览以棋盘格表示透明区域；部分浏览器会循环播放。下载按钮会保存完整文件。';
    this.progressBar.value = 100;
    this.result.hidden = false;
    this.progress.hidden = true;
    this.setMode('done');
    this.downloadButton.textContent = `下载 ${result.format === 'webp' ? 'WebP' : 'GIF'} · ${formatBytes(result.sizeBytes)}`;
    window.requestAnimationFrame(() => this.downloadButton.focus());
  }

  private showError(message: string): void {
    this.errorBox.textContent = message;
    this.errorBox.classList.remove('is-info');
    this.errorBox.hidden = false;
    this.errorBox.tabIndex = -1;
    this.errorBox.focus();
  }

  private showInfo(message: string): void {
    this.errorBox.textContent = message;
    this.errorBox.classList.add('is-info');
    this.errorBox.hidden = false;
    this.errorBox.tabIndex = -1;
    this.errorBox.focus();
  }

  private requestCancel(): void {
    if (this.mode !== 'running') {
      this.closeNow();
      return;
    }
    this.cancelButton.disabled = true;
    this.cancelButton.textContent = '正在取消…';
    this.controller?.abort();
  }

  private requestClose(): void {
    if (this.mode === 'running') {
      this.closeAfterCancel = true;
      this.cancelButton.disabled = true;
      this.cancelButton.textContent = '正在取消…';
      this.controller?.abort();
      return;
    }
    this.closeNow();
  }

  private closeNow(): void {
    this.revokeResult();
    if (this.dialog.open) this.dialog.close();
  }

  private revokeResult(): void {
    if (this.resultUrl) {
      URL.revokeObjectURL(this.resultUrl);
      this.resultUrl = null;
    }
    this.preview.removeAttribute('src');
  }

  private download(): void {
    if (!this.lastResult || !this.resultUrl) return;
    const options = this.lastOptions ?? this.readOptions();
    const structure = this.callbacks.getStructureId();
    const filename = `crystal-atlas-${structure}-${options.size}px-${options.duration}s-${options.fps}fps.${exportExtension(options.format)}`;
    const link = document.createElement('a');
    link.href = this.resultUrl;
    link.download = filename;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}
