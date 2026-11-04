export interface LabelSpec {
  id: string;
  /** One short line only, e.g. "OCT · 6/6" or "M · 面心". */
  text: string;
  accent: string;
  /** Screen-space anchor in CSS pixels, relative to the stage/canvas. */
  anchor: { x: number; y: number };
  compact?: boolean;
}

interface LabelItem {
  element: HTMLDivElement;
  line: HTMLDivElement;
  spec: LabelSpec;
}

const SAFE = 8;
const OFFSET = 26;

/**
 * Screen-space label overlay. DOM text stays crisp, can be clamped to the
 * canvas safe area and can avoid the bottom status rail. Labels are hidden
 * during drag/orbit; only one selected object gets a full label at a time.
 */
export class LabelLayer {
  private readonly layer: HTMLElement;
  private readonly items = new Map<string, LabelItem>();
  private signature = '';
  private visible = true;

  constructor(layer: HTMLElement) {
    this.layer = layer;
  }

  setLabels(specs: LabelSpec[]): void {
    const signature = specs
      .map(
        (spec) =>
          `${spec.id}:${spec.text}:${Math.round(spec.anchor.x)},${Math.round(spec.anchor.y)}:${spec.compact ? 1 : 0}`,
      )
      .join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    const keep = new Set(specs.map((spec) => spec.id));
    for (const [id, item] of this.items) {
      if (!keep.has(id)) {
        item.element.remove();
        item.line.remove();
        this.items.delete(id);
      }
    }

    for (const spec of specs) {
      let item = this.items.get(spec.id);
      if (!item) {
        const element = document.createElement('div');
        element.className = spec.compact ? 'scene-label is-compact' : 'scene-label';
        const line = document.createElement('div');
        line.className = 'scene-label-line';
        const dot = document.createElement('span');
        dot.className = 'scene-label-dot';
        const text = document.createElement('span');
        text.className = 'scene-label-text';
        element.append(dot, text);
        this.layer.append(line, element);
        item = { element, line, spec };
        this.items.set(spec.id, item);
      }
      item.spec = spec;
      item.element.classList.toggle('is-compact', Boolean(spec.compact));
      item.element.style.setProperty('--label-accent', spec.accent);
      const text = item.element.querySelector<HTMLElement>('.scene-label-text');
      if (text) text.textContent = spec.text;
    }

    this.layout();
    this.setVisible(this.visible);
  }

  private layout(): void {
    const width = this.layer.clientWidth;
    const height = this.layer.clientHeight;
    if (width < 2 || height < 2) return;

    const rail = document.querySelector<HTMLElement>('.status-rail');
    const stage = this.layer.parentElement;
    let bottomLimit = height - SAFE;
    if (rail && stage) {
      const stageRect = stage.getBoundingClientRect();
      const railRect = rail.getBoundingClientRect();
      if (railRect.height > 0) {
        bottomLimit = Math.min(bottomLimit, railRect.top - stageRect.top - SAFE);
      }
    }

    for (const item of this.items.values()) {
      const { element, line, spec } = item;
      const w = element.offsetWidth;
      const h = element.offsetHeight;
      const leftSide = spec.anchor.x < width / 2;
      const topSide = spec.anchor.y < height / 2;
      const offset = spec.compact ? OFFSET - 6 : OFFSET;

      let x = leftSide ? spec.anchor.x - offset - w : spec.anchor.x + offset;
      let y = topSide ? spec.anchor.y - offset - h : spec.anchor.y + offset;
      x = Math.max(SAFE, Math.min(x, width - w - SAFE));
      y = Math.max(SAFE, Math.min(y, bottomLimit - h));

      element.style.left = `${x}px`;
      element.style.top = `${y}px`;

      const targetX = Math.max(x, Math.min(spec.anchor.x, x + w));
      const targetY = Math.max(y, Math.min(spec.anchor.y, y + h));
      const dx = targetX - spec.anchor.x;
      const dy = targetY - spec.anchor.y;
      const length = Math.hypot(dx, dy);
      if (length < 4) {
        line.style.display = 'none';
        continue;
      }
      line.style.display = 'block';
      line.style.left = `${spec.anchor.x}px`;
      line.style.top = `${spec.anchor.y}px`;
      line.style.width = `${length}px`;
      line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      line.style.setProperty('--label-accent', spec.accent);
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    // Use visibility rather than display:none so offsets can still be measured
    // while labels are hidden (drag, auto-rotate, hover).
    this.layer.classList.toggle('is-hidden', !visible);
    this.layer.setAttribute('aria-hidden', String(!visible));
  }

  /** Viewport rect of the first non-compact label, used to keep tooltips clear. */
  getActiveRect(): DOMRect | null {
    if (!this.visible) return null;
    for (const item of this.items.values()) {
      if (item.spec.compact) continue;
      return item.element.getBoundingClientRect();
    }
    return null;
  }

  get count(): number {
    return this.items.size;
  }

  clear(): void {
    for (const item of this.items.values()) item.element.remove();
    for (const item of this.items.values()) item.line.remove();
    this.items.clear();
    this.signature = '';
  }

  dispose(): void {
    this.clear();
  }
}
