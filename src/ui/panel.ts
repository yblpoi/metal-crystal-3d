import type { CrystalModel, InterstitialSite, SiteType, StructureId } from '../crystal/types';
import {
  computeAtomVisibility,
  isSiteVisibleInDisplay,
  siteNeighborsFullyVisible,
  siteVisibleCoordination,
  type DisplayMode,
} from '../crystal/visibility';
import { resolveBackground } from '../background';
import { filterSites } from '../site-filter';
import {
  RADIAL_SPLIT,
  resolveAtomColor,
  resolveCellStyle,
  selectedAtom as pickSelectedAtom,
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
  restoreSelectedAtom: () => void;
  resetAllAtomColors: () => void;
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
  private readonly scroll = document.querySelector<HTMLElement>('.panel-scroll');
  private readonly backdrop = byId<HTMLElement>('sheet-backdrop');
  private readonly settingsButton = byId<HTMLButtonElement>('mobile-settings');
  private readonly media = window.matchMedia('(max-width: 860px)');
  private readonly sections = new Map<string, HTMLElement>();
  private lastSelectedAtomId: string | null = null;
  private diagramKey = '';
  private sitesWereActive = false;
  private autoOpenedSites = false;
  private sheetOpen = false;

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
        store.set({ colorMode: mode });
      });
    }

    byId<HTMLInputElement>('color-inner').addEventListener('input', (event) => {
      const value = (event.target as HTMLInputElement).value.toUpperCase();
      store.set({ colorInner: value });
    });
    byId<HTMLInputElement>('color-outer').addEventListener('input', (event) => {
      const value = (event.target as HTMLInputElement).value.toUpperCase();
      store.set({ colorOuter: value });
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
        selectedAtomId: enabled ? store.state.selectedAtomId : null,
      });
    });
    byId<HTMLInputElement>('atom-color').addEventListener('input', (event) => {
      const id = store.state.selectedAtomId;
      if (!id) return;
      this.actions.setAtomColor(id, (event.target as HTMLInputElement).value.toUpperCase());
    });
    byId<HTMLButtonElement>('atom-restore').addEventListener('click', () =>
      this.actions.restoreSelectedAtom(),
    );
    byId<HTMLButtonElement>('reset-all-colors').addEventListener('click', () =>
      this.actions.resetAllAtomColors(),
    );

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

    byId<HTMLButtonElement>('panel-close').addEventListener('click', () => this.closeSheet());
  }

  private bindSheet(): void {
    this.settingsButton.addEventListener('click', () => this.toggleSheet());
    this.backdrop.addEventListener('click', () => this.closeSheet());
    this.media.addEventListener('change', () => {
      if (!this.media.matches) this.closeSheet();
      else this.panel.inert = !this.sheetOpen;
    });
    this.panel.inert = this.media.matches;
  }

  isMobile(): boolean {
    return this.media.matches;
  }

  isSheetOpen(): boolean {
    return this.sheetOpen;
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
    this.panel.inert = this.media.matches;
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
    setText('display-visible-count', String(atomVisibility.count));
    setText('display-total-count', String(meta.clusterAtomCount));

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
        ? `配位壳 · CN ${shellCn} · 显示 ${atomVisibility.count}/${meta.clusterAtomCount}`
        : state.displayMode === 'all'
          ? `显示全部 · ${Math.round(state.atomDisplayRadius * 100)}% r`
          : `缩球示意 · 显示 ${atomVisibility.count}/${meta.clusterAtomCount}`,
    );

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === state.colorMode));
    }
    const modeText = COLOR_MODE_TEXT[state.colorMode];
    setText('inner-label', modeText.inner);
    setText('outer-label', modeText.outer);
    setText('color-mode-note', modeText.note);

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
    const atom = pickSelectedAtom(state, model.atoms);
    const atomEmpty = byId<HTMLElement>('atom-empty');
    const atomContent = byId<HTMLElement>('atom-content');
    const atomColor = byId<HTMLInputElement>('atom-color');
    const restore = byId<HTMLButtonElement>('atom-restore');
    const resetAll = byId<HTMLButtonElement>('reset-all-colors');
    const editBadge = byId<HTMLElement>('edit-badge');
    if (atom) {
      atomEmpty.hidden = true;
      atomContent.hidden = false;
      setText('atom-kind', atomKindLabel(atom.kind));
      setText('atom-struct', `${meta.abbreviation} · 通用金属 M · ${atom.kind}`);
      setText('atom-layer', atomLayerLabel(atom, state.structure));
      setText('atom-frac', fracText(atom.fractional.x, atom.fractional.y, atom.fractional.z));
      setText('atom-layer-detail', `${atomLayerLabel(atom, state.structure)} · ${atom.kind}`);
      const color = resolveAtomColor(atom, meta, state);
      atomColor.value = color;
      atomColor.disabled = false;
      setText('atom-color-hex', color);
      restore.disabled = !state.atomColors[atom.id];
      editBadge.textContent = `${meta.abbreviation} · ${atomKindLabel(atom.kind)}`;
      editBadge.classList.remove('quiet');
    } else {
      atomEmpty.hidden = false;
      atomContent.hidden = true;
      atomColor.disabled = true;
      restore.disabled = true;
      editBadge.textContent = '—';
      editBadge.classList.add('quiet');
    }
    resetAll.disabled = Object.keys(state.atomColors).length === 0;

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-bg]')) {
      button.setAttribute('aria-pressed', String(button.dataset.bg === state.background));
      button.classList.toggle('is-active', button.dataset.bg === state.background);
    }
    const theme = resolveBackground(state.background, state.customBg);
    const bgInput = byId<HTMLInputElement>('bg-custom');
    bgInput.value = theme.c;
    setText('bg-hex', theme.c.toUpperCase());

    if (state.selectedAtomId && state.selectedAtomId !== this.lastSelectedAtomId) {
      if (this.isMobile() && !this.sheetOpen) this.openSheet();
      this.openSection('edit', true);
    }
    this.lastSelectedAtomId = state.selectedAtomId;
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
