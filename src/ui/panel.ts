import type { CrystalModel, InterstitialSite, SiteType, StructureId } from '../crystal/types';
import {
  computeAtomRenderState,
  computeAtomVisibility,
  isSiteVisibleInDisplay,
  siteNeighborsFullyVisible,
  siteVisibleCoordination,
  type DisplayMode,
} from '../crystal/visibility';
import {
  HCP_C_OVER_A,
  HCP_MAX_C_OVER_A,
  HCP_MIN_C_OVER_A,
  clampHcpCOverA,
} from '../crystal/structures';
import { resolveBackground } from '../background';
import { filterSites } from '../site-filter';
import {
  RADIAL_SPLIT,
  atomEditCount,
  resolveAtomColor,
  resolveAtomSize,
  resolveCellStyle,
  selectedAtoms as pickSelectedAtoms,
  type AppState,
  type AppStore,
  type BackgroundPreset,
  type ColorMode,
  type SiteFilter,
} from '../state';
import { cellDiagramSvg } from './cell-diagram';
import {
  atomKindLabel,
  atomLayerLabel,
  cellNote,
  fmt,
  fracText,
  pct,
  siteCoordinationLabel,
  structureExamples,
} from './format';

export interface PanelActions {
  setStructure: (id: StructureId) => void;
  setSiteType: (type: SiteType, enabled: boolean) => void;
  enterSiteMode: () => void;
  showAllSites: () => void;
  selectSite: (id: string) => void;
  focusSite: (id: string) => void;
  copySite: (id: string) => void;
  returnToCenter: () => void;
  resetView: () => void;
  fitView: () => void;
  setDisplayRadius: (radius: number, fit?: boolean) => void;
  setDisplayRange: (range: number) => void;
  setDisplayMode: (mode: DisplayMode, announce?: boolean) => void;
  setFollowSites: (enabled: boolean) => void;
  resetDisplay: () => void;
  setAtomColor: (id: string, hex: string) => void;
  setAtomColors: (ids: string[], hex: string) => void;
  setAtomSizes: (ids: string[], size: number) => void;
  hideAtoms: (ids: string[]) => void;
  showAllHiddenAtoms: () => void;
  restoreAtomEdits: (ids: string[]) => void;
  resetAllAtomEdits: () => void;
  setHcpCOverA: (ratio: number, announce?: boolean) => void;
  clearAtomSelection: () => void;
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function setText(id: string, text: string): void {
  byId(id).textContent = text;
}

const SITE_NOTES: Record<StructureId, string> = {
  fcc: 'OCT：体心 + 12 条棱中点（净 4/胞）；TET：(1/4, 3/4)³ 的 8 个组合。',
  bcc: 'OCT 是扁八面体：2 近 + 4 远（a/2 与 a/√2），几何半径由 2 个近邻锁定；TET 为 4 配位。',
  hcp: '六方棱柱：6 原子、OCT 6、TET 12；原胞：2 原子、OCT 2、TET 4。棱柱计数 = 原胞 × 3。',
};

const COLOR_MODE_TEXT: Record<ColorMode, { inner: string; outer: string; note: string }> = {
  radial: { inner: '内层', outer: '外层', note: `径向分层 ≤ ${RADIAL_SPLIT.toFixed(2)}` },
  stacking: { inner: 'A / 偶层', outer: 'B / 奇层', note: '按堆垛 / z 晶面交替' },
  gold: { inner: '统一金色', outer: '金色', note: '纯金模式使用外层金色' },
};

export class Panel {
  private readonly store: AppStore;
  private readonly actions: PanelActions;
  private readonly getModel: () => CrystalModel;
  private readonly panel = byId<HTMLElement>('panel');
  private readonly grid = document.querySelector<HTMLElement>('.app-grid');
  private readonly scroll = document.querySelector<HTMLElement>('.panel-scroll');
  private readonly backdrop = byId<HTMLElement>('sheet-backdrop');
  private readonly settingsButton = byId<HTMLButtonElement>('mobile-settings');
  private readonly panelToggle = byId<HTMLButtonElement>('panel-toggle');
  private readonly media = window.matchMedia('(max-width: 860px)');
  private readonly sections = new Map<string, HTMLElement>();
  private lastSelectionKey = '';
  private diagramKey = '';
  private sitesWereActive = false;
  private autoOpenedSites = false;
  private sheetOpen = false;
  private collapsed = false;

  constructor(store: AppStore, actions: PanelActions, getModel: () => CrystalModel) {
    this.store = store;
    this.actions = actions;
    this.getModel = getModel;

    for (const section of document.querySelectorAll<HTMLElement>('.psec')) {
      const name = section.dataset.section ?? '';
      this.sections.set(name, section);
      const head = section.querySelector<HTMLButtonElement>('.ps-head');
      const body = section.querySelector<HTMLElement>('.ps-body');
      if (!head || !body) continue;
      head.addEventListener('click', () => {
        const open = !section.classList.contains('is-open');
        section.classList.toggle('is-open', open);
        head.setAttribute('aria-expanded', String(open));
        body.hidden = !open;
        if (open && name === 'sites') section.classList.remove('is-highlight');
      });
    }

    this.bindControls();
    this.bindSheet();
    this.update(this.store.state);
  }

  private bindControls(): void {
    const store = this.store;

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode as ColorMode;
        store.set({ colorMode: mode, allAtomColor: null });
      });
    }

    byId<HTMLInputElement>('color-inner').addEventListener('input', (event) => {
      const value = (event.target as HTMLInputElement).value.toUpperCase();
      store.set({ colorInner: value, allAtomColor: null });
    });
    byId<HTMLInputElement>('color-outer').addEventListener('input', (event) => {
      const value = (event.target as HTMLInputElement).value.toUpperCase();
      store.set({ colorOuter: value, allAtomColor: null });
    });

    byId<HTMLInputElement>('toggle-autorotate').addEventListener('change', (event) => {
      store.set({ autoRotate: (event.target as HTMLInputElement).checked });
    });
    byId<HTMLInputElement>('speed').addEventListener('input', (event) => {
      store.set({ autoRotateSpeed: Number((event.target as HTMLInputElement).value) });
    });
    byId<HTMLInputElement>('toggle-cell').addEventListener('change', (event) => {
      store.set({ showCell: (event.target as HTMLInputElement).checked });
    });
    byId<HTMLInputElement>('toggle-xray').addEventListener('change', (event) => {
      store.set({ cellXray: (event.target as HTMLInputElement).checked });
    });
    byId<HTMLInputElement>('cell-width').addEventListener('input', (event) => {
      store.set({
        cellLineWidth: Number((event.target as HTMLInputElement).value),
        cellStyleAuto: false,
      });
    });
    byId<HTMLInputElement>('cell-brightness').addEventListener('input', (event) => {
      store.set({
        cellLineBrightness: Number((event.target as HTMLInputElement).value) / 100,
        cellStyleAuto: false,
      });
    });
    byId<HTMLButtonElement>('cell-auto-btn').addEventListener('click', () => {
      store.set({ cellStyleAuto: true });
    });
    byId<HTMLInputElement>('toggle-ghost').addEventListener('change', (event) => {
      store.set({ ghostAtoms: (event.target as HTMLInputElement).checked });
    });
    byId<HTMLInputElement>('toggle-atoms').addEventListener('change', (event) => {
      store.set({ showAtoms: (event.target as HTMLInputElement).checked });
    });

    byId<HTMLButtonElement>('site-enter-btn').addEventListener('click', () =>
      this.actions.enterSiteMode(),
    );
    byId<HTMLButtonElement>('site-all-btn').addEventListener('click', () =>
      this.actions.showAllSites(),
    );
    byId<HTMLInputElement>('toggle-site-o').addEventListener('change', (event) => {
      this.actions.setSiteType('O', (event.target as HTMLInputElement).checked);
    });
    byId<HTMLInputElement>('toggle-site-t').addEventListener('change', (event) => {
      this.actions.setSiteType('T', (event.target as HTMLInputElement).checked);
    });
    byId<HTMLInputElement>('site-size').addEventListener('input', (event) => {
      store.set({ siteScale: Number((event.target as HTMLInputElement).value) / 100 });
    });
    byId<HTMLInputElement>('site-opacity').addEventListener('input', (event) => {
      store.set({ siteOpacity: Number((event.target as HTMLInputElement).value) / 100 });
    });
    byId<HTMLInputElement>('toggle-poly').addEventListener('change', (event) => {
      store.set({ showPolyhedron: (event.target as HTMLInputElement).checked });
    });
    byId<HTMLInputElement>('toggle-site-labels').addEventListener('change', (event) => {
      store.set({ showSiteLabels: (event.target as HTMLInputElement).checked });
    });
    byId<HTMLInputElement>('toggle-bonds').addEventListener('change', (event) => {
      store.set({ showBonds: (event.target as HTMLInputElement).checked });
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
      button.addEventListener('click', () => {
        const filter = button.dataset.filter as SiteFilter;
        if (filter === 'selected' && !this.store.state.selectedSiteId) return;
        store.set({ siteFilter: filter });
      });
    }

    byId<HTMLButtonElement>('reset-view-btn').addEventListener('click', () => this.actions.resetView());
    byId<HTMLButtonElement>('fit-view-btn').addEventListener('click', () => this.actions.fitView());

    byId<HTMLInputElement>('display-radius').addEventListener('input', (event) => {
      this.actions.setDisplayRadius(Number((event.target as HTMLInputElement).value) / 100);
    });
    byId<HTMLButtonElement>('display-radius-reset').addEventListener('click', () => {
      this.actions.setDisplayRadius(1, true);
    });
    byId<HTMLInputElement>('display-range').addEventListener('input', (event) => {
      this.actions.setDisplayRange(Number((event.target as HTMLInputElement).value) / 100);
    });
    byId<HTMLButtonElement>('display-all-btn').addEventListener('click', () => {
      this.actions.setDisplayMode('all', true);
    });
    byId<HTMLButtonElement>('display-shell-btn').addEventListener('click', () => {
      this.actions.setDisplayMode('shell', true);
    });
    byId<HTMLInputElement>('display-follow-sites').addEventListener('change', (event) => {
      this.actions.setFollowSites((event.target as HTMLInputElement).checked);
    });
    byId<HTMLButtonElement>('display-reset-btn').addEventListener('click', () => {
      this.actions.resetDisplay();
    });
    byId<HTMLButtonElement>('site-center-btn').addEventListener('click', () =>
      this.actions.returnToCenter(),
    );

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-browser-type]')) {
      button.addEventListener('click', () => {
        const type = button.dataset.browserType as SiteType;
        const state = this.store.state;
        if (state.siteBrowserType === type && (type === 'O' ? state.showO : state.showT)) return;
        if (type === 'O' && !state.showO) this.actions.setSiteType('O', true);
        if (type === 'T' && !state.showT) this.actions.setSiteType('T', true);
        this.store.set({ siteBrowserType: type });
        const list = this.browserList(this.getModel(), this.store.state, type);
        if (list.length > 0) this.actions.selectSite(list[0].id);
      });
    }

    byId<HTMLButtonElement>('site-prev').addEventListener('click', () => this.stepBrowser(-1));
    byId<HTMLButtonElement>('site-next').addEventListener('click', () => this.stepBrowser(1));
    byId<HTMLButtonElement>('site-focus').addEventListener('click', () => {
      const site = this.currentSite();
      if (site) this.actions.focusSite(site.id);
      else {
        const list = this.browserList(this.getModel(), this.store.state, this.store.state.siteBrowserType);
        if (list.length > 0) this.actions.focusSite(list[0].id);
      }
    });
    byId<HTMLButtonElement>('site-copy').addEventListener('click', () => {
      const site = this.currentSite();
      if (site) this.actions.copySite(site.id);
    });

    byId<HTMLInputElement>('toggle-edit').addEventListener('change', (event) => {
      const enabled = (event.target as HTMLInputElement).checked;
      store.set({
        editMode: enabled,
        selectedAtomIds: enabled ? store.state.selectedAtomIds : [],
      });
    });
    const selectedIds = (): string[] => this.store.state.selectedAtomIds.slice();
    byId<HTMLInputElement>('atom-color').addEventListener('input', (event) => {
      const ids = selectedIds();
      if (ids.length === 0) return;
      this.actions.setAtomColors(ids, (event.target as HTMLInputElement).value.toUpperCase());
    });
    byId<HTMLInputElement>('atom-size').addEventListener('input', (event) => {
      const ids = selectedIds();
      if (ids.length === 0) return;
      this.actions.setAtomSizes(ids, Number((event.target as HTMLInputElement).value) / 100);
    });
    byId<HTMLButtonElement>('atom-hide').addEventListener('click', () => {
      this.actions.hideAtoms(selectedIds());
    });
    byId<HTMLButtonElement>('atom-show-hidden').addEventListener('click', () =>
      this.actions.showAllHiddenAtoms(),
    );
    byId<HTMLButtonElement>('atom-restore').addEventListener('click', () =>
      this.actions.restoreAtomEdits(selectedIds()),
    );
    byId<HTMLButtonElement>('reset-all-colors').addEventListener('click', () =>
      this.actions.resetAllAtomEdits(),
    );

    // Scientific HCP c/a sandbox (see crystal/structures#hcpLattice).
    const hcpSlider = byId<HTMLInputElement>('hcp-ca');
    hcpSlider.min = (HCP_MIN_C_OVER_A * 100).toFixed(1);
    hcpSlider.max = (HCP_MAX_C_OVER_A * 100).toFixed(1);
    hcpSlider.addEventListener('input', () => {
      this.actions.setHcpCOverA(Number(hcpSlider.value) / 100);
    });
    byId<HTMLButtonElement>('hcp-ca-reset').addEventListener('click', () =>
      this.actions.setHcpCOverA(HCP_C_OVER_A),
    );
    // Keyboard twin of the drag slider: non-numeric input reverts to the ideal
    // ratio, out-of-range input is clamped to the hard-sphere valid interval.
    const hcpNumber = byId<HTMLInputElement>('hcp-ca-number');
    hcpNumber.min = HCP_MIN_C_OVER_A.toFixed(3);
    hcpNumber.max = HCP_MAX_C_OVER_A.toFixed(3);
    hcpNumber.addEventListener('change', () => {
      const requested = Number(hcpNumber.value);
      if (!Number.isFinite(requested)) {
        hcpNumber.value = HCP_C_OVER_A.toFixed(3);
        return;
      }
      // Pass the raw value so the app can clamp *and* explain the scientific
      // interval it applied; only the displayed value is pre-clamped here.
      this.actions.setHcpCOverA(requested, true);
      hcpNumber.value = clampHcpCOverA(requested).toFixed(3);
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-bg]')) {
      button.addEventListener('click', () => {
        store.set({ background: button.dataset.bg as BackgroundPreset });
      });
    }
    byId<HTMLInputElement>('bg-custom').addEventListener('input', (event) => {
      store.set({
        background: 'custom',
        customBg: (event.target as HTMLInputElement).value.toUpperCase(),
      });
    });

    byId<HTMLButtonElement>('panel-close').addEventListener('click', () => this.togglePanel());
  }

  private bindSheet(): void {
    this.settingsButton.addEventListener('click', () => this.toggleSheet());
    this.panelToggle.addEventListener('click', () => this.togglePanel());
    this.backdrop.addEventListener('click', () => this.closeSheet());
    this.media.addEventListener('change', () => {
      if (!this.media.matches) {
        this.closeSheet();
        this.setCollapsed(false);
      } else {
        this.panel.inert = !this.sheetOpen;
      }
    });
    this.panel.inert = this.media.matches;
  }

  isMobile(): boolean {
    return this.media.matches;
  }

  isSheetOpen(): boolean {
    return this.sheetOpen;
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  /** Collapse/expand the control deck. Mobile keeps the sheet behaviour. */
  setCollapsed(collapsed: boolean): void {
    if (this.media.matches) return;
    this.collapsed = collapsed;
    this.grid?.classList.toggle('panel-collapsed', collapsed);
    this.panelToggle.setAttribute('aria-expanded', String(!collapsed));
    this.panel.setAttribute('aria-hidden', String(collapsed));
    this.panel.inert = collapsed;
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
  }

  togglePanel(): void {
    if (this.media.matches) {
      this.toggleSheet();
      return;
    }
    this.setCollapsed(!this.collapsed);
  }

  openSheet(): void {
    if (!this.media.matches) return;
    this.sheetOpen = true;
    this.panel.classList.add('is-open');
    this.panel.inert = false;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.backdrop.hidden = false;
    this.settingsButton.setAttribute('aria-expanded', 'true');
    this.openSection('display', true);
    window.setTimeout(() => byId<HTMLButtonElement>('panel-close').focus(), 60);
  }

  closeSheet(): void {
    const wasOpen = this.sheetOpen;
    this.sheetOpen = false;
    this.panel.classList.remove('is-open');
    this.panel.inert = this.media.matches ? true : this.collapsed;
    this.panel.removeAttribute('role');
    this.panel.removeAttribute('aria-modal');
    this.backdrop.hidden = true;
    this.settingsButton.setAttribute('aria-expanded', 'false');
    if (wasOpen && this.media.matches) this.settingsButton.focus();
  }

  toggleSheet(): void {
    if (this.sheetOpen) this.closeSheet();
    else this.openSheet();
  }

  private openSection(name: string, scrollIntoView = false): void {
    const section = this.sections.get(name);
    if (!section) return;
    if (!section.classList.contains('is-open')) {
      section.classList.add('is-open');
      const head = section.querySelector<HTMLButtonElement>('.ps-head');
      const body = section.querySelector<HTMLElement>('.ps-body');
      head?.setAttribute('aria-expanded', 'true');
      if (body) body.hidden = false;
    }
    if (scrollIntoView && this.scroll) {
      const offset =
        this.scroll.scrollTop +
        section.getBoundingClientRect().top -
        this.scroll.getBoundingClientRect().top -
        8;
      // Auto (not smooth): the call may happen while the panel is being
      // revealed, and a smooth scroll can be cancelled by that layout change.
      this.scroll.scrollTo({ top: Math.max(0, offset), behavior: 'auto' });
    }
  }

  private closeSection(name: string): void {
    const section = this.sections.get(name);
    if (!section || !section.classList.contains('is-open')) return;
    section.classList.remove('is-open');
    const head = section.querySelector<HTMLButtonElement>('.ps-head');
    const body = section.querySelector<HTMLElement>('.ps-body');
    head?.setAttribute('aria-expanded', 'false');
    if (body) body.hidden = true;
  }

  private browserList(
    model: CrystalModel,
    state: Readonly<AppState>,
    type: SiteType,
  ): InterstitialSite[] {
    const visibility = computeAtomVisibility(model.atoms, state.displayMode, state.displayRange);
    return filterSites(
      model.sites,
      state.showO,
      state.showT,
      state.siteFilter,
      state.selectedSiteId,
    )
      .filter(
        (site) =>
          !state.followRangeForSites ||
          isSiteVisibleInDisplay(
            site,
            model,
            visibility.visible,
            state.displayMode,
            state.displayRange,
            state.followRangeForSites,
          ),
      )
      .filter((site) => site.type === type);
  }

  private currentSite(): InterstitialSite | null {
    const id = this.store.state.selectedSiteId;
    if (!id) return null;
    const site = this.getModel().sites.find((candidate) => candidate.id === id) ?? null;
    return site && site.type === this.store.state.siteBrowserType ? site : null;
  }

  private stepBrowser(delta: number): void {
    const state = this.store.state;
    const list = this.browserList(this.getModel(), state, state.siteBrowserType);
    if (list.length === 0) return;
    const current = this.currentSite();
    const index = current ? list.findIndex((site) => site.id === current.id) : -1;
    const next = index < 0 ? 0 : (index + delta + list.length) % list.length;
    this.actions.selectSite(list[next].id);
  }

  update(state: Readonly<AppState>): void {
    const model = this.getModel();
    const meta = model.meta;

    if (this.diagramKey !== state.structure) {
      this.diagramKey = state.structure;
      byId('cell-diagram').innerHTML = cellDiagramSvg(state.structure);
    }

    setText('data-ar', fmt(meta.lattice.a, 4));
    setText('data-ca', meta.lattice.cOverA === null ? '—' : fmt(meta.lattice.cOverA, 4));
    setText('data-cn', String(meta.coordinationNumber));
    setText('data-apf', pct(meta.apf));
    setText('data-atoms', String(meta.atomsPerConventionalCell));
    setText('data-cluster', String(meta.clusterAtomCount));
    setText('data-metals', structureExamples(state.structure));
    setText('data-cellnote', cellNote(state.structure));

    const renderState = computeAtomRenderState(
      model.atoms,
      state.displayMode,
      state.displayRange,
      state.atomHidden,
      state.ghostAtoms,
    );
    const atomVisibility = computeAtomVisibility(model.atoms, state.displayMode, state.displayRange);
    const radius = byId<HTMLInputElement>('display-radius');
    radius.value = String(Math.round(state.atomDisplayRadius * 100));
    setText(
      'display-radius-out',
      `${state.atomDisplayRadius.toFixed(2)}r · ${Math.round(state.atomDisplayRadius * 100)}%`,
    );
    const displayRange = byId<HTMLInputElement>('display-range');
    displayRange.value = String(Math.round(state.displayRange * 100));
    setText('display-range-out', `${Math.round(state.displayRange * 100)}%`);
    setText('display-visible-count', String(renderState.solidCount));
    setText('display-total-count', String(meta.clusterAtomCount));
    setText('display-xray-count', String(renderState.xrayCount));

    const shellButton = byId<HTMLButtonElement>('display-shell-btn');
    const shellCn = atomVisibility.shell.coordination;
    shellButton.textContent =
      state.displayMode === 'shell'
        ? `配位壳 · 中心 + ${shellCn} 邻居（CN ${shellCn}）`
        : `配位壳（第一配位壳）· CN ${shellCn}`;
    shellButton.setAttribute('aria-pressed', String(state.displayMode === 'shell'));
    byId<HTMLButtonElement>('display-all-btn').setAttribute(
      'aria-pressed',
      String(state.displayMode === 'all'),
    );
    byId<HTMLInputElement>('display-follow-sites').checked = state.followRangeForSites;
    setText(
      'display-cn-note',
      state.structure === 'bcc'
        ? 'BCC 真实 CN = 8；12 仅适用于 FCC / HCP。配位壳 = 中心 + 8 邻居（9 球），不会为了凑 12 加球。'
        : `${meta.abbreviation} 的 CN = 12；配位壳 = 中心 + 12 邻居（13 球）。`,
    );
    setText(
      'display-badge',
      state.displayMode === 'shell'
        ? `配位壳 · CN ${shellCn} · 实心 ${renderState.solidCount}/${meta.clusterAtomCount}`
        : state.displayMode === 'all'
          ? `显示全部 · ${Math.round(state.atomDisplayRadius * 100)}% r`
          : `缩球示意 · 实心 ${renderState.solidCount}/${meta.clusterAtomCount}${
              renderState.xrayCount > 0 ? ` · 透视 ${renderState.xrayCount}` : ''
            }`,
    );

    // HCP c/a scientific sandbox (the only free structural parameter).
    const isHcp = state.structure === 'hcp';
    byId<HTMLElement>('hcp-param-controls').hidden = !isHcp;
    byId<HTMLElement>('cubic-param-lock').hidden = isHcp;
    if (isHcp) {
      const ratio = meta.lattice.cOverA ?? HCP_C_OVER_A;
      const hcpSlider = byId<HTMLInputElement>('hcp-ca');
      hcpSlider.value = (ratio * 100).toFixed(1);
      const hcpNumber = byId<HTMLInputElement>('hcp-ca-number');
      if (document.activeElement !== hcpNumber) hcpNumber.value = ratio.toFixed(3);
      setText('hcp-ca-out', ratio.toFixed(3));
      setText('param-ar', fmt(meta.lattice.a, 4));
      setText('param-cr', fmt(meta.lattice.c ?? 0, 4));
      setText('param-apf', pct(meta.apf));
      const interlayer =
        meta.lattice.c === null
          ? 0
          : Math.sqrt(meta.lattice.a ** 2 / 3 + meta.lattice.c ** 2 / 4);
      setText(
        'param-note',
        `硬球模型要求 c/a ≥ √(8/3) ≈ 1.633：更小的 c 会让相邻层原子重叠，因此下限被锁定。当前层间最近邻距离 ${interlayer.toFixed(3)}（同层 2.000），O/T 间隙 r/R = ${meta.radiusRatioOctahedral.toFixed(3)} / ${meta.radiusRatioTetrahedral.toFixed(3)}。r = 1 始终不变。`,
      );
    }

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === state.colorMode));
    }
    const modeText = COLOR_MODE_TEXT[state.colorMode];
    setText('inner-label', modeText.inner);
    setText('outer-label', modeText.outer);
    setText(
      'color-mode-note',
      state.allAtomColor ? `统一色 ${state.allAtomColor} · 已覆盖` : modeText.note,
    );

    const innerInput = byId<HTMLInputElement>('color-inner');
    innerInput.value = state.colorInner;
    innerInput.disabled = state.colorMode === 'gold';
    innerInput.closest('.color-field')?.classList.toggle('is-disabled', state.colorMode === 'gold');
    setText('color-inner-hex', state.colorInner);
    byId<HTMLInputElement>('color-outer').value = state.colorOuter;
    setText('color-outer-hex', state.colorOuter);

    const auto = byId<HTMLInputElement>('toggle-autorotate');
    auto.checked = state.autoRotate;
    const speed = byId<HTMLInputElement>('speed');
    speed.value = String(state.autoRotateSpeed);
    speed.disabled = !state.autoRotate;
    setText('speed-out', `${state.autoRotateSpeed.toFixed(1)}×`);

    byId<HTMLInputElement>('toggle-cell').checked = state.showCell;
    byId<HTMLInputElement>('toggle-xray').checked = state.cellXray;
    const cellStyle = resolveCellStyle(state);
    const cellWidth = byId<HTMLInputElement>('cell-width');
    cellWidth.value = cellStyle.width.toFixed(1);
    setText(
      'cell-width-out',
      `${cellStyle.width.toFixed(1)} px${cellStyle.auto ? ' · 自动' : ''}`,
    );
    const cellBrightness = byId<HTMLInputElement>('cell-brightness');
    cellBrightness.value = String(Math.round(cellStyle.brightness * 100));
    setText(
      'cell-brightness-out',
      `${Math.round(cellStyle.brightness * 100)}%${cellStyle.auto ? ' · 自动' : ''}`,
    );
    const autoButton = byId<HTMLButtonElement>('cell-auto-btn');
    autoButton.setAttribute('aria-pressed', String(state.cellStyleAuto));
    autoButton.classList.toggle('is-on', state.cellStyleAuto);
    byId<HTMLInputElement>('toggle-ghost').checked = state.ghostAtoms;
    byId<HTMLInputElement>('toggle-atoms').checked = state.showAtoms;

    byId<HTMLInputElement>('toggle-site-o').checked = state.showO;
    byId<HTMLInputElement>('toggle-site-t').checked = state.showT;
    const size = byId<HTMLInputElement>('site-size');
    size.value = String(Math.round(state.siteScale * 100));
    setText('site-size-out', `${Math.round(state.siteScale * 100)}%`);
    const opacity = byId<HTMLInputElement>('site-opacity');
    opacity.value = String(Math.round(state.siteOpacity * 100));
    setText('site-opacity-out', `${Math.round(state.siteOpacity * 100)}%`);
    byId<HTMLInputElement>('toggle-poly').checked = state.showPolyhedron;
    byId<HTMLInputElement>('toggle-site-labels').checked = state.showSiteLabels;
    byId<HTMLInputElement>('toggle-bonds').checked = state.showBonds;

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
      const filter = button.dataset.filter;
      button.setAttribute('aria-pressed', String(filter === state.siteFilter));
      if (filter === 'selected') button.disabled = !state.selectedSiteId;
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-browser-type]')) {
      button.setAttribute('aria-pressed', String(button.dataset.browserType === state.siteBrowserType));
    }

    const visible = filterSites(
      model.sites,
      state.showO,
      state.showT,
      state.siteFilter,
      state.selectedSiteId,
    ).filter(
      (site) =>
        !state.followRangeForSites ||
        isSiteVisibleInDisplay(
          site,
          model,
          atomVisibility.visible,
          state.displayMode,
          state.displayRange,
          state.followRangeForSites,
        ),
    );
    const visibleO = visible.filter((site) => site.type === 'O').length;
    const visibleT = visible.filter((site) => site.type === 'T').length;
    const complete = visible.filter(
      (site) => siteVisibleCoordination(site, atomVisibility.visible) === site.expectedCoordination,
    ).length;
    setText('site-badge', `${visibleO} OCT · ${visibleT} TET`);
    setText('site-display', String(visible.length));
    setText('site-complete-count', String(complete));
    const theory =
      state.siteBrowserType === 'O'
        ? meta.octahedralPerConventionalCell
        : meta.tetrahedralPerConventionalCell;
    setText('site-theory', `${theory}/${meta.id === 'hcp' ? '棱柱' : '胞'}`);
    setText('site-note', SITE_NOTES[state.structure]);
    const completeVisibleO = visible.filter(
      (site) =>
        site.type === 'O' &&
        siteVisibleCoordination(site, atomVisibility.visible) === site.expectedCoordination,
    ).length;
    const completeVisibleT = visible.filter(
      (site) =>
        site.type === 'T' &&
        siteVisibleCoordination(site, atomVisibility.visible) === site.expectedCoordination,
    ).length;
    setText(
      'site-range-note',
      state.followRangeForSites
        ? `当前显示范围 ${completeVisibleO} 个完整 OCT、${completeVisibleT} 个完整 TET；关闭「间隙位跟随显示范围」可查看全部。`
        : `已关闭跟随：显示全部 ${visibleO} OCT / ${visibleT} TET，配位原子可能在画面外。`,
    );
    byId<HTMLButtonElement>('site-center-btn').hidden = !state.focusedSiteId;
    byId<HTMLButtonElement>('site-enter-btn').hidden = state.showO || state.showT;

    this.updateBrowser(state);

    const activeSites = state.showO || state.showT;
    this.sections.get('sites')?.classList.toggle('is-idle', !activeSites);
    if (activeSites && !this.sitesWereActive) {
      if (this.isMobile() && !this.sheetOpen) this.openSheet();
      this.openSection('sites', true);
      this.autoOpenedSites = true;
    } else if (!activeSites && this.sitesWereActive && this.autoOpenedSites) {
      this.closeSection('sites');
      this.autoOpenedSites = false;
    }
    this.sitesWereActive = activeSites;

    const edit = byId<HTMLInputElement>('toggle-edit');
    edit.checked = state.editMode;
    const selected = pickSelectedAtoms(state, model.atoms);
    const primary = selected[0] ?? null;
    const atomEmpty = byId<HTMLElement>('atom-empty');
    const atomContent = byId<HTMLElement>('atom-content');
    const atomColor = byId<HTMLInputElement>('atom-color');
    const atomSize = byId<HTMLInputElement>('atom-size');
    const restore = byId<HTMLButtonElement>('atom-restore');
    const hide = byId<HTMLButtonElement>('atom-hide');
    const showHidden = byId<HTMLButtonElement>('atom-show-hidden');
    const resetAll = byId<HTMLButtonElement>('reset-all-colors');
    const editBadge = byId<HTMLElement>('edit-badge');
    const hiddenCount = Object.keys(state.atomHidden).length;
    const hiddenNote = byId<HTMLElement>('atom-hidden-note');
    if (primary) {
      atomEmpty.hidden = true;
      atomContent.hidden = false;
      setText('atom-selected-count', String(selected.length));
      setText(
        'atom-kind',
        selected.length > 1 ? `${selected.length} 个原子` : atomKindLabel(primary.kind),
      );
      setText('atom-struct', `${meta.abbreviation} · 通用金属 M · ${primary.kind}`);
      setText('atom-layer', atomLayerLabel(primary, state.structure));
      setText(
        'atom-frac',
        selected.length > 1
          ? '多选 · 混合晶位'
          : fracText(primary.fractional.x, primary.fractional.y, primary.fractional.z),
      );
      setText(
        'atom-layer-detail',
        selected.length > 1
          ? `${selected.length} 个晶位`
          : `${atomLayerLabel(primary, state.structure)} · ${primary.kind}`,
      );
      const color = resolveAtomColor(primary, meta, state);
      atomColor.value = color;
      atomColor.disabled = false;
      setText('atom-color-hex', color);
      const sizeValue = resolveAtomSize(state, primary.id);
      atomSize.value = String(Math.round(sizeValue * 100));
      setText('atom-size-out', `${Math.round(sizeValue * 100)}%`);
      atomSize.disabled = false;
      restore.disabled = !selected.some(
        (atom) => state.atomColors[atom.id] || state.atomSizes[atom.id] || state.atomHidden[atom.id],
      );
      hide.disabled = false;
      editBadge.textContent =
        selected.length > 1
          ? `${selected.length} 个原子`
          : `${meta.abbreviation} · ${atomKindLabel(primary.kind)}`;
      editBadge.classList.remove('quiet');
    } else {
      atomEmpty.hidden = false;
      atomContent.hidden = true;
      atomColor.disabled = true;
      atomSize.disabled = true;
      restore.disabled = true;
      hide.disabled = true;
      editBadge.textContent = '—';
      editBadge.classList.add('quiet');
    }
    showHidden.disabled = hiddenCount === 0;
    showHidden.textContent =
      hiddenCount > 0 ? `显示全部隐藏 (${hiddenCount})` : '显示全部隐藏';
    hiddenNote.hidden = hiddenCount === 0;
    if (hiddenCount > 0) {
      hiddenNote.textContent = `已隐藏 ${hiddenCount} 个原子；可用「显示全部隐藏」或右下角浮动卡片恢复。`;
    }
    resetAll.disabled = atomEditCount(state) === 0;

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-bg]')) {
      button.setAttribute('aria-pressed', String(button.dataset.bg === state.background));
      button.classList.toggle('is-active', button.dataset.bg === state.background);
    }
    const theme = resolveBackground(state.background, state.customBg);
    const bgInput = byId<HTMLInputElement>('bg-custom');
    bgInput.value = theme.c;
    setText('bg-hex', theme.c.toUpperCase());

    const selectionKey = state.selectedAtomIds.join('|');
    if (selectionKey && selectionKey !== this.lastSelectionKey) {
      if (this.isMobile() && !this.sheetOpen) this.openSheet();
      this.openSection('edit', true);
    }
    this.lastSelectionKey = selectionKey;
  }

  private updateBrowser(state: Readonly<AppState>): void {
    const list = this.browserList(this.getModel(), state, state.siteBrowserType);
    const site = this.currentSite();
    const index = site ? list.findIndex((candidate) => candidate.id === site.id) : -1;
    setText('site-position', list.length === 0 ? '0 / 0' : `${index < 0 ? '—' : index + 1} / ${list.length}`);

    const prev = byId<HTMLButtonElement>('site-prev');
    const next = byId<HTMLButtonElement>('site-next');
    prev.disabled = list.length === 0;
    next.disabled = list.length === 0;
    byId<HTMLButtonElement>('site-focus').disabled = list.length === 0;
    byId<HTMLButtonElement>('site-copy').disabled = !site;

    const stateBadge = byId<HTMLElement>('site-state');
    const visibility = computeAtomVisibility(
      this.getModel().atoms,
      state.displayMode,
      state.displayRange,
    );
    if (site) {
      setText('site-frac', fracText(site.fractional.x, site.fractional.y, site.fractional.z));
      setText('site-cn', siteCoordinationLabel(site));
      setText('site-rmax', site.maxRadius.toFixed(3));
      stateBadge.textContent = site.complete ? '完整配位' : '边界欠配位';
      stateBadge.classList.toggle('is-incomplete', !site.complete);
      const neighborsVisible = siteNeighborsFullyVisible(site, visibility.visible);
      const note = byId<HTMLElement>('site-neighbor-note');
      note.hidden = neighborsVisible;
      if (!neighborsVisible) {
        note.textContent = `配位原子在显示范围外 · 可见 ${siteVisibleCoordination(
          site,
          visibility.visible,
        )}/${site.expectedCoordination}`;
      }
    } else {
      setText('site-frac', '—');
      setText('site-cn', '—');
      setText('site-rmax', '—');
      stateBadge.textContent = '未选择';
      stateBadge.classList.remove('is-incomplete');
      byId<HTMLElement>('site-neighbor-note').hidden = true;
    }
  }
}

export function createPanel(
  store: AppStore,
  actions: PanelActions,
  getModel: () => CrystalModel,
): Panel {
  return new Panel(store, actions, getModel);
}
