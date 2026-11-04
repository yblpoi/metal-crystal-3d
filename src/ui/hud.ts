import type { CrystalModel, StructureId } from '../crystal/types';
import { computeAtomRenderState } from '../crystal/visibility';
import type { AppState } from '../state';
import {
  cellDescriptor,
  fmt,
  pct,
  structureEnglish,
  structureIndex,
} from './format';

export interface TooltipContent {
  tag: string;
  frac: string;
  meta: string;
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

export class Hud {
  private readonly stage = byId<HTMLElement>('stage');
  private readonly tooltip = byId<HTMLElement>('tooltip');
  private readonly toast = byId<HTMLElement>('toast');
  private readonly toastText = byId<HTMLElement>('toast-text');
  private readonly loading = byId<HTMLElement>('loading');
  private readonly fatal = byId<HTMLElement>('fatal');
  private readonly onStructure: (id: StructureId) => void;
  private toastTimer = 0;

  constructor(onStructure: (id: StructureId) => void) {
    this.onStructure = onStructure;
    for (const card of document.querySelectorAll<HTMLButtonElement>('[data-structure]')) {
      card.addEventListener('click', () => {
        const id = card.dataset.structure as StructureId | undefined;
        if (id) this.onStructure(id);
      });
    }
  }

  update(state: Readonly<AppState>, model: CrystalModel): void {
    const meta = model.meta;
    byId('top-badge').textContent = meta.abbreviation;
    byId('top-name').textContent = meta.name;
    byId('top-en').textContent = structureEnglish(state.structure);
    byId('stage-index').textContent = structureIndex(state.structure);
    byId('stage-name').textContent = meta.name;
    byId('stage-en').textContent = structureEnglish(state.structure);

    byId('top-chips').innerHTML = [
      `<span class="chip"><i>CN</i><b>${meta.coordinationNumber}</b></span>`,
      `<span class="chip"><i>APF</i><b>${pct(meta.apf, 2)}</b></span>`,
      `<span class="chip"><i>a/r</i><b>${fmt(meta.lattice.a, 4)}</b></span>`,
    ].join('');

    const cellText =
      meta.id === 'hcp' ? 'A-B-A · 3 层' : cellDescriptor(meta.id, model.cellRepeat);
    const render = computeAtomRenderState(
      model.atoms,
      state.displayMode,
      state.displayRange,
      state.atomHidden,
      state.ghostAtoms,
    );
    byId('stage-chips').innerHTML = [
      state.ghostAtoms
        ? `<span class="stage-chip" style="font-variant-numeric: tabular-nums"><b>${render.baseCount}</b> / ${meta.clusterAtomCount} 原子 · 原子透视</span>`
        : `<span class="stage-chip" style="font-variant-numeric: tabular-nums"><b>${render.solidCount}</b> / ${meta.clusterAtomCount} 原子${
            render.xrayCount > 0 ? ` · <em>透视 ${render.xrayCount}</em>` : ''
          }</span>`,
      `<span class="stage-chip">${cellText}</span>`,
      `<span class="stage-chip scale-chip">显示 ${state.atomDisplayRadius.toFixed(2)}r · 数据 r = 1</span>`,
      `<span class="stage-chip mobile-chip"><em>CN</em><b>${meta.coordinationNumber}</b></span>`,
      `<span class="stage-chip mobile-chip"><em>APF</em><b>${pct(meta.apf, 2)}</b></span>`,
      `<span class="stage-chip mobile-chip"><span class="chip-dot dot-o"></span>OCT <span class="chip-dot dot-t"></span>TET</span>`,
    ].join('');

    for (const card of document.querySelectorAll<HTMLButtonElement>('[data-structure]')) {
      const active = card.dataset.structure === state.structure;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-pressed', String(active));
    }

    byId('auto-rotate-toggle').setAttribute('aria-checked', String(state.autoRotate));
    byId<HTMLButtonElement>('auto-rotate-toggle').setAttribute(
      'aria-label',
      state.autoRotate ? '关闭自动旋转' : '开启自动旋转',
    );

    byId('legend-atom').textContent = `显示 ${state.atomDisplayRadius.toFixed(2)}r`;
    byId('legend-o').textContent = `r/R ${meta.radiusRatioOctahedral.toFixed(3)}`;
    byId('legend-t').textContent = `r/R ${meta.radiusRatioTetrahedral.toFixed(3)}`;
    const ghostRow = byId<HTMLElement>('legend-ghost-row');
    ghostRow.hidden = render.xrayCount === 0;
    byId('legend-ghost').textContent = `范围外 ${render.xrayCount}`;
    const oRow = byId<HTMLElement>('legend-o-row');
    const tRow = byId<HTMLElement>('legend-t-row');
    oRow.style.opacity = state.showO ? '1' : '0.38';
    tRow.style.opacity = state.showT ? '1' : '0.38';

    const hint = byId<HTMLElement>('hint');
    const mobile = window.matchMedia('(max-width: 860px)').matches;
    if (mobile) {
      hint.innerHTML = state.editMode
        ? '<span class="hint-key">单击</span> 原子改色/隐藏/大小 <span class="hint-sep"></span> 单指旋转'
        : '<span class="hint-key">单指</span> 旋转 <span class="hint-sep"></span> <span class="hint-key">双指</span> 缩放';
    } else if (state.editMode) {
      hint.innerHTML =
        '<span class="hint-key">单击</span> 选中原子 <span class="hint-sep"></span><span class="hint-key">Ctrl/Shift</span> 多选 <span class="hint-sep"></span><span class="hint-key">拖动</span> 旋转';
    } else if (state.showO || state.showT) {
      hint.innerHTML =
        '<span class="hint-key">点击</span> 间隙球看配位 <span class="hint-sep"></span><span class="hint-key">拖动</span> 旋转 <span class="hint-sep"></span><span class="hint-key">1 / 2 / 3</span> 切换';
    } else {
      hint.innerHTML =
        '<span class="hint-key">拖动</span> 旋转 <span class="hint-sep"></span><span class="hint-key">滚轮</span> 缩放 <span class="hint-sep"></span><span class="hint-key">1 / 2 / 3</span> 切换结构';
    }

    if (state.structure === 'hcp') {
      byId('loading-sub').textContent = 'HCP · 57 ATOMS · A-B-A';
    }

    // Publish the rail height so the quick dock / atom card can float above it
    // without hard-coded offsets that break when the legend grows.
    const rail = document.querySelector<HTMLElement>('.status-rail');
    if (rail) {
      const height = rail.getBoundingClientRect().height;
      if (height > 0) this.stage.style.setProperty('--rail-h', `${Math.round(height)}px`);
    }
  }

  focusStructureCard(id: StructureId): void {
    const card = document.querySelector<HTMLButtonElement>(`[data-structure="${id}"]`);
    card?.focus({ preventScroll: true });
  }

  showTooltip(
    content: TooltipContent,
    clientX: number,
    clientY: number,
    avoid?: DOMRect | null,
  ): void {
    byId('tooltip-tag').textContent = content.tag;
    byId('tooltip-frac').textContent = content.frac;
    byId('tooltip-meta').textContent = content.meta;
    this.tooltip.hidden = false;
    this.tooltip.style.left = '0px';
    this.tooltip.style.top = '0px';
    const stageRect = this.stage.getBoundingClientRect();
    const rect = this.tooltip.getBoundingClientRect();
    const rail = document.querySelector<HTMLElement>('.status-rail');
    const railTop = rail ? rail.getBoundingClientRect().top - stageRect.top : stageRect.height;
    const maxX = stageRect.width - rect.width - 8;
    const maxY = Math.min(stageRect.height, railTop) - rect.height - 10;

    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(value, Math.max(min, max)));

    const intersects = (box: { left: number; top: number; right: number; bottom: number }) =>
      Boolean(
        avoid &&
          box.left < avoid.right &&
          box.right > avoid.left &&
          box.top < avoid.bottom &&
          box.bottom > avoid.top,
      );

    const pointerInsideAvoid =
      Boolean(avoid) &&
      clientX >= avoid!.left &&
      clientX <= avoid!.right &&
      clientY >= avoid!.top &&
      clientY <= avoid!.bottom;

    let x = clientX - stageRect.left + 14;
    let y = clientY - stageRect.top + 14;
    if (pointerInsideAvoid) {
      // Keep the card off the selected target ring / label.
      x = avoid!.right - stageRect.left + 14;
      y = clientY - stageRect.top - rect.height / 2;
      if (x > maxX) x = avoid!.left - stageRect.left - rect.width - 14;
    } else {
      if (x > maxX) x = clientX - stageRect.left - rect.width - 14;
      if (y > maxY) y = clientY - stageRect.top - rect.height - 14;
    }
    x = clamp(x, 8, maxX);
    y = clamp(y, 8, maxY);

    let box = {
      left: stageRect.left + x,
      top: stageRect.top + y,
      right: stageRect.left + x + rect.width,
      bottom: stageRect.top + y + rect.height,
    };

    if (intersects(box)) {
      // Move above the pointer, then clamp again. If it still collides with the
      // selected-object label, hide rather than stacking two cards.
      x = clamp(clientX - stageRect.left - rect.width / 2, 8, maxX);
      y = clamp(clientY - stageRect.top - rect.height - 18, 8, maxY);
      box = {
        left: stageRect.left + x,
        top: stageRect.top + y,
        right: stageRect.left + x + rect.width,
        bottom: stageRect.top + y + rect.height,
      };
      if (intersects(box)) {
        this.hideTooltip();
        return;
      }
    }

    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  hideTooltip(): void {
    this.tooltip.hidden = true;
  }

  showToast(message: string): void {
    this.toastText.textContent = message;
    this.toast.hidden = false;
    const stageRect = this.stage.getBoundingClientRect();
    const rail = document.querySelector<HTMLElement>('.status-rail');
    const railTop = rail ? rail.getBoundingClientRect().top : stageRect.bottom;
    this.toast.style.bottom = `${Math.max(18, stageRect.bottom - railTop + 10)}px`;
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
      this.toastTimer = 0;
    }, 2600);
  }

  markReady(): void {
    this.stage.classList.add('is-ready');
    this.stage.setAttribute('aria-busy', 'false');
    window.setTimeout(() => {
      this.loading.hidden = true;
    }, 650);
  }

  showFatal(): void {
    this.loading.hidden = true;
    this.fatal.hidden = false;
    this.stage.classList.add('is-ready');
  }
}
