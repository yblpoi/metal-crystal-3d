import { Vector2, Vector3 } from 'three';
import {
  HCP_MAX_C_OVER_A,
  HCP_MIN_C_OVER_A,
  buildCrystal,
  clampHcpCOverA,
} from './crystal/structures';
import type { Atom, CrystalModel, InterstitialSite, StructureId } from './crystal/types';
import {
  clampDisplayRadius,
  clampDisplayRange,
  computeAtomRenderState,
  computeAtomVisibility,
  isSiteVisibleInDisplay,
  siteNeighborsFullyVisible,
  siteVisibleCoordination,
  visibleSitesInDisplay,
  type AtomRenderState,
  type DisplayMode,
} from './crystal/visibility';
import { resolveBackground } from './background';
import { filterSites } from './site-filter';
import {
  DEFAULT_COLOR_INNER,
  DEFAULT_COLOR_OUTER,
  RADIAL_SPLIT,
  atomEditCount,
  clampAtomSize,
  isHexColor,
  normalizeHex,
  resolveAtomColor,
  resolveAtomSize,
  resolveCellStyle,
  resolveHcpCOverA,
  type AppState,
  type CellRepeat,
  type SiteFilter,
} from './state';
import { AtomLayer } from './scene/atoms';
import { CellLayer, cellWireRadius } from './scene/cell';
import { InterstitialLayer, SITE_COLORS } from './scene/interstitials';
import { CoordinationShellLayer } from './scene/shell';
import { LabelLayer, type LabelSpec } from './scene/labels';
import { Viewer, type CameraSnapshot, type RendererInfo } from './scene/viewer';
import { AppStore as Store } from './state';
import { ExportDialog } from './ui/dialog';
import { runExportSession } from './export/session';
import type { ExportHooks, ExportOptions, ExportResult } from './export/types';
import { icon } from './ui/icons';
import {
  atomKindLabel,
  atomLayerLabel,
  fracText,
  siteCoordinationLabel,
  siteShapeLabel,
} from './ui/format';
import { Hud } from './ui/hud';
import { Panel, createPanel, type PanelActions } from './ui/panel';
import { renderShell } from './ui/templates';

const STRUCTURE_IDS: StructureId[] = ['fcc', 'bcc', 'hcp'];

export interface DebugState {
  structure: StructureId;
  cellRepeat: CellRepeat;
  colorMode: AppState['colorMode'];
  colorInner: string;
  colorOuter: string;
  /** Primary (first) selected atom, kept for the existing acceptance scripts. */
  selectedAtomId: string | null;
  selectedAtomIds: string[];
  selectedSiteId: string | null;
  focusedSiteId: string | null;
  editMode: boolean;
  autoRotate: boolean;
  autoRotateSpeed: number;
  showCell: boolean;
  cellXray: boolean;
  cellLineWidth: number;
  cellLineBrightness: number;
  cellStyleAuto: boolean;
  ghostAtoms: boolean;
  showAtoms: boolean;
  atomDisplayRadius: number;
  displayRange: number;
  displayMode: DisplayMode;
  followRangeForSites: boolean;
  showO: boolean;
  showT: boolean;
  siteScale: number;
  siteOpacity: number;
  siteFilter: SiteFilter;
  siteBrowserType: 'O' | 'T';
  atomColors: Record<string, string>;
  atomHidden: Record<string, boolean>;
  atomSizes: Record<string, number>;
  allAtomColor: string | null;
  hcpCOverA: number;
  background: AppState['background'];
}

export interface ScreenBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface DebugApi {
  getState: () => DebugState;
  setStructure: (id: StructureId) => boolean;
  selectAtomByIndex: (index: number) => boolean;
  setAtomColor: (id: string, hex: string) => boolean;
  getSelectedAtomIds: () => string[];
  setAtomHidden: (ids: string[], hidden: boolean) => void;
  setAtomSize: (ids: string[], size: number) => void;
  clearSelection: () => void;
  setHcpCOverA: (ratio: number) => boolean;
  setCellRepeat: (repeat: CellRepeat) => void;
  getAtomRenderInfo: () => { solid: number; xray: number; rendered: number; hidden: number };
  isAtomRendered: (index: number) => boolean;
  getCamera: () => CameraSnapshot;
  setAutoRotate: (enabled: boolean) => void;
  setEditMode: (enabled: boolean) => void;
  showInterstitials: (show: boolean) => void;
  getCounts: () => {
    O: number;
    T: number;
    completeO: number;
    completeT: number;
    theoryO: number;
    theoryT: number;
  };
  focusSite: (id: string) => boolean;
  resetView: () => void;
  getAtomScreenPosition: (index: number) => { x: number; y: number; inView: boolean } | null;
  getSiteScreenPosition: (id: string) => { x: number; y: number; inView: boolean } | null;
  getLabelCount: () => number;
  getCellInfo: () => ReturnType<CellLayer['getInfo']>;
  getCellAnchorInfo: () => {
    anchor: [number, number, number];
    /** Atom sitting on the cell anchor, -1 when the anchor is not an atom. */
    anchorAtomIndex: number;
    anchorKind: string | null;
    anchorLayer: number | null;
    centerIndex: number;
    centerPosition: [number, number, number] | null;
    matchesShellCenter: boolean;
  };
  getShellVisualInfo: () => ReturnType<CoordinationShellLayer['getInfo']>;
  getShellRingInfo: () => { visible: boolean; index: number | null; scale: number };
  getVisibleAtomStats: () => {
    count: number;
    xrayCount: number;
    layers: Record<string, number>;
    shells: Record<string, number>;
    centerIndex: number;
    centerPosition: [number, number, number] | null;
    centerDistance: number;
  };
  getGhostInfo: () => { blending: 'NormalBlending'; opacity: number; depthWrite: boolean };
  getSelectionInfo: () => { mode: 'target-ring'; hasCage: false; visible: boolean };
  getSiteMaterialInfo: () => {
    renderOrder: number;
    depthWrite: boolean;
    opacity: number;
    transparent: boolean;
  };
  getModelScreenBounds: () => ScreenBounds | null;
  getVisibleAtomScreenExtents: () => {
    index: number;
    x: number;
    y: number;
    radius: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
  }[];
  getAtomScreenDiameter: (index: number) => number | null;
  isAtomVisible: (index: number) => boolean;
  getDisplayInfo: () => {
    displayRadius: number;
    visibleAtomCount: number;
    totalAtomCount: number;
    hiddenAtomIndices: number[];
    xrayAtomIndices: number[];
    visibleSiteCount: number;
    completeVisibleSiteCount: number;
    shellSize: number;
    shellCoordination: number;
    shellCenterIndex: number;
    fitRadius: number;
    cellBoundsRadius: number;
    cellCornerBoundsRadius: number;
    ringScale: number;
  };
  setDisplay: (options: {
    radius?: number;
    range?: number;
    mode?: DisplayMode;
    followSites?: boolean;
  }) => void;
  resetDisplay: () => void;
  fitView: () => void;
  getSiteVisibilityInfo: () => {
    id: string;
    type: 'O' | 'T';
    complete: boolean;
    visible: boolean;
    allNeighborsVisible: boolean;
    visibleCoordination: number;
  }[];
  getSelectionPolyhedronInfo: () => { hasPolyhedron: boolean; neighborsVisible: boolean };
  getScaleReference: () => number;
  getVisibleSiteCount: () => number;
  getRendererInfo: () => RendererInfo;
  getExportState: () => {
    running: boolean;
    hasResult: boolean;
    last: { format: string; width: number; height: number; frames: number } | null;
  };
}

declare global {
  interface Window {
    __CRYSTAL_READY__?: boolean;
    __CRYSTAL_DEBUG__?: DebugApi;
  }
}

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function bootstrap(): void {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) return;
  renderShell(root);

  const store = new Store();
  const modelCache = new Map<string, CrystalModel>();
  const modelKey = (id: StructureId): string => {
    if (id === 'hcp') return `hcp@${resolveHcpCOverA(store.state).toFixed(6)}`;
    // Cubic clusters are built per repeat count: 1x1x1 (14/9 atoms) and
    // 2x2x2 (63/35 atoms) must never share a cached model.
    return `${id}@r${store.state.cellRepeat}`;
  };
  const modelFor = (id: StructureId): CrystalModel => {
    const key = modelKey(id);
    let model = modelCache.get(key);
    if (!model) {
      // Keep the cache bounded when the HCP c/a slider sweeps through values.
      if (modelCache.size >= 12) {
        for (const cacheKey of [...modelCache.keys()]) {
          if (cacheKey.includes('@')) modelCache.delete(cacheKey);
        }
      }
      model = buildCrystal(id, {
        hcpCOverA: resolveHcpCOverA(store.state),
        cellRepeat: store.state.cellRepeat,
      });
      modelCache.set(key, model);
    }
    return model;
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hud = new Hud((id) => switchStructure(id));
  const canvas = must<HTMLCanvasElement>('crystal-canvas');
  // Frame the cell wireframe, not the full 57-atom HCP bounding sphere: the
  // default view is a 19-atom shrunken cluster inside a cell, and the old
  // HCP-radius framing left ~18% of the stage empty. The same radius is used
  // for every structure so the atom scale stays comparable.
  // The frame radius is shared by the three structures at one cell-repeat
  // tier, so the atom scale stays comparable across FCC/BCC/HCP; it is
  // recomputed when the 1x1x1 / 2x2x2 toggle changes the cluster size.
  const frameRadiusFor = (repeat: CellRepeat): number =>
    Math.max(
      ...STRUCTURE_IDS.map((id) => cellWireRadius(buildCrystal(id, { cellRepeat: repeat }))),
    );
  const defaultFrameRadius = frameRadiusFor(store.state.cellRepeat);
  let viewer: Viewer;
  try {
    viewer = new Viewer(canvas, {
      frameRadius: defaultFrameRadius,
      reducedMotion,
    });
  } catch {
    window.__CRYSTAL_READY__ = false;
    hud.showFatal();
    return;
  }

  const atomLayer = new AtomLayer();
  const cellLayer = new CellLayer();
  const siteLayer = new InterstitialLayer();
  const shellLayer = new CoordinationShellLayer();
  const labels = new LabelLayer(must<HTMLElement>('label-layer'));
  viewer.root.add(atomLayer.group, cellLayer.group, siteLayer.group, shellLayer.group);

  let currentModel = modelFor(store.state.structure);
  let panel: Panel | null = null;
  let pointerDown: { x: number; y: number; pointerId: number } | null = null;
  const ndc = new Vector2();

  const dialog = new ExportDialog({
    start: (options, hooks) => runExport(options, hooks),
    getStructureId: () => store.state.structure,
    getSelectionInfo: () => {
      const site = store.state.selectedSiteId
        ? currentModel.sites.find((candidate) => candidate.id === store.state.selectedSiteId) ?? null
        : null;
      if (!site || !site.complete) return { available: false, label: '' };
      return {
        available: true,
        label: `${site.type === 'O' ? 'OCT' : 'TET'} · ${fracText(site.fractional.x, site.fractional.y, site.fractional.z, 2)}`,
      };
    },
  });

  function switchStructure(id: StructureId): void {
    if (!STRUCTURE_IDS.includes(id)) return;
    const state = store.state;
    if (state.structure === id) {
      resetView();
      return;
    }
    store.set({
      structure: id,
      selectedAtomIds: [],
      selectedSiteId: null,
      focusedSiteId: null,
      siteFilter: state.siteFilter === 'selected' ? 'all' : state.siteFilter,
    });
    const meta = modelFor(id).meta;
    hud.showToast(`${meta.abbreviation} · ${meta.name} · CN ${meta.coordinationNumber}`);
  }

  function centralSite(type: 'O' | 'T'): InterstitialSite | null {
    const state = store.state;
    const visibility = computeAtomVisibility(currentModel.atoms, state.displayMode, state.displayRange);
    const candidates = currentModel.sites.filter(
      (site) =>
        site.type === type &&
        site.complete &&
        (!state.followRangeForSites ||
          isSiteVisibleInDisplay(
            site,
            currentModel,
            visibility.visible,
            state.displayMode,
            state.displayRange,
            state.followRangeForSites,
          )),
    );
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => {
      const da = Math.hypot(a.position.x, a.position.y, a.position.z);
      const db = Math.hypot(b.position.x, b.position.y, b.position.z);
      return da - db;
    })[0];
  }

  function enterSiteMode(type: 'O' | 'T' = 'O'): void {
    const site = centralSite(type);
    store.set({
      showO: type === 'O',
      showT: type === 'T',
      ghostAtoms: true,
      siteScale: 0.7,
      siteOpacity: 0.6,
      siteFilter: 'complete',
      siteBrowserType: type,
      selectedAtomIds: [],
      selectedSiteId: site?.id ?? null,
      focusedSiteId: null,
    });
    hud.showToast(type === 'O' ? 'OCT 完整配位 · 已选中心位点' : 'TET 完整配位 · 已选中心位点');
  }

  function showAllSites(): void {
    const all = currentModel.sites;
    const octahedral = all.filter((site) => site.type === 'O').length;
    const tetrahedral = all.filter((site) => site.type === 'T').length;
    store.set({
      showO: true,
      showT: true,
      ghostAtoms: true,
      siteFilter: 'all',
      siteScale: 0.5,
      siteOpacity: 0.55,
      siteBrowserType: 'O',
      followRangeForSites: false,
    });
    hud.showToast(
      `已显示全部 ${all.length} 个位点（关闭跟随范围），密度较高（OCT ${octahedral} / TET ${tetrahedral}）`,
    );
  }

  function setSiteType(type: 'O' | 'T', enabled: boolean): void {
    const state = store.state;
    const other = type === 'O' ? state.showT : state.showO;
    const bothOffBefore = !state.showO && !state.showT;
    const willBothOff = !enabled && !other;
    const patch: Partial<AppState> = type === 'O' ? { showO: enabled } : { showT: enabled };

    if (enabled && bothOffBefore) {
      // First entry is the curated teaching state, never the full 96-site dump.
      patch.ghostAtoms = true;
      patch.siteScale = 0.7;
      patch.siteOpacity = 0.6;
      patch.siteFilter = 'complete';
      patch.siteBrowserType = type;
      patch.selectedAtomIds = [];
      const site = centralSite(type);
      patch.selectedSiteId = site?.id ?? null;
      patch.focusedSiteId = null;
      hud.showToast(`${type === 'O' ? 'OCT' : 'TET'} 完整配位 · 已选中心位点`);
    }
    if (!enabled && state.siteBrowserType === type) {
      patch.siteBrowserType = other && type === 'O' ? 'T' : 'O';
    }
    if (willBothOff) {
      patch.ghostAtoms = false;
      patch.selectedSiteId = null;
      patch.focusedSiteId = null;
      if (state.siteFilter === 'selected') patch.siteFilter = 'all';
    }
    store.set(patch);
  }

  /**
   * Click selection. A plain click replaces the selection; Ctrl / Cmd / Shift
   * inserts or removes one atom (the multi-select workflow). The primary entry
   * of `selectedAtomIds` drives the single-atom inspector.
   */
  function selectAtom(atom: Atom, additive = false): void {
    const state = store.state;
    const ids = state.selectedAtomIds;
    const next = additive
      ? ids.includes(atom.id)
        ? ids.filter((id) => id !== atom.id)
        : [...ids, atom.id]
      : [atom.id];
    store.set({
      editMode: true,
      selectedAtomIds: next,
      selectedSiteId: null,
      focusedSiteId: null,
    });
    if (state.focusedSiteId) viewer.focusTarget(null, 450);
  }

  function selectSite(site: InterstitialSite): void {
    const hadFocus = Boolean(store.state.focusedSiteId);
    store.set({
      selectedAtomIds: [],
      selectedSiteId: site.id,
      focusedSiteId: null,
      siteBrowserType: site.type,
    });
    if (hadFocus) viewer.focusTarget(null, 450);
  }

  function selectSiteById(id: string): boolean {
    const site = currentModel.sites.find((candidate) => candidate.id === id);
    if (!site) return false;
    selectSite(site);
    return true;
  }

  function copySite(id: string): void {
    const site = currentModel.sites.find((candidate) => candidate.id === id);
    if (!site) return;
    const text = fracText(site.fractional.x, site.fractional.y, site.fractional.z);
    const toast = () => hud.showToast(`已复制分数坐标 ${text}`);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(toast).catch(() => hud.showToast('复制失败，请手动选择坐标'));
    } else {
      hud.showToast('当前浏览器不支持剪贴板');
    }
  }

  function clearSelection(): void {
    const state = store.state;
    hud.hideTooltip();
    const hadFocus = Boolean(state.focusedSiteId);
    store.set({
      selectedAtomIds: [],
      selectedSiteId: null,
      focusedSiteId: null,
      siteFilter: state.siteFilter === 'selected' ? 'all' : state.siteFilter,
    });
    if (hadFocus) viewer.focusTarget(null, 450);
  }

  function siteWorld(site: InterstitialSite): Vector3 {
    viewer.root.updateMatrixWorld(true);
    return viewer.root.localToWorld(
      new Vector3(site.position.x, site.position.y, site.position.z),
    );
  }

  function focusSite(id: string): void {
    const site = currentModel.sites.find((candidate) => candidate.id === id);
    if (!site) return;
    store.set({
      selectedAtomIds: [],
      selectedSiteId: site.id,
      focusedSiteId: site.id,
      siteBrowserType: site.type,
    });
    viewer.focusTarget(siteWorld(site), 480);
    panel?.closeSheet();
  }

  function returnToCenter(): void {
    if (!store.state.focusedSiteId) return;
    store.set({ focusedSiteId: null });
    viewer.focusTarget(null, 450);
  }

  function resetView(): void {
    store.set({ focusedSiteId: null });
    viewer.resetViewToFit(currentViewRadius(store.state), 450);
    hud.showToast('视角已重置 · 已按当前内容适应视图');
  }

  function setDisplayRadius(value: number, fit = false): void {
    store.set({ atomDisplayRadius: clampDisplayRadius(value) });
    // "相切硬球 100%" is a preset button; the slider must keep the user's zoom.
    if (fit) autoFitVisible();
  }

  function setDisplayRange(value: number): void {
    store.set({ displayRange: clampDisplayRange(value), displayMode: 'range' });
  }

  function setDisplayMode(mode: DisplayMode, announce = false): void {
    // "Show all" also parks the range slider at 100 % so the panel does not
    // claim 40 % while every atom is visible.
    store.set({ displayMode: mode, ...(mode === 'all' ? { displayRange: 1 } : {}) });
    if (!announce) return;
    if (mode === 'shell') {
      const shell = computeAtomVisibility(currentModel.atoms, 'shell', store.state.displayRange).shell;
      const cn = shell.coordination;
      hud.showToast(
        `配位壳 · 中心 + ${cn} 邻居（CN ${cn}）${currentModel.id === 'bcc' ? ' · BCC 真实 CN=8' : ''}`,
      );
    } else if (mode === 'all') {
      hud.showToast(`已显示全部 ${currentModel.atoms.length} 个原子`);
    }
    autoFitVisible();
  }

  /**
   * Same-button toggle for the display-mode presets ("显示全部", "配位壳").
   * Clicking the preset that is already active returns to the plain range
   * mode instead of forcing the user to hunt for "重置显示" first.
   */
  function toggleDisplayMode(mode: DisplayMode): void {
    if (store.state.displayMode === mode) {
      store.set({ displayMode: 'range' });
      hud.showToast('已关闭 · 回到范围显示');
      autoFitVisible();
      return;
    }
    setDisplayMode(mode, true);
  }

  function setFollowSites(enabled: boolean): void {
    store.set({ followRangeForSites: enabled });
    hud.showToast(
      enabled
        ? '间隙位跟随显示范围 · 配位不全的位点已隐藏'
        : '间隙位不再跟随范围 · 可能出现悬空配位',
    );
  }

  function resetDisplay(): void {
    store.set({
      atomDisplayRadius: 0.5,
      displayRange: 1,
      displayMode: 'range',
      followRangeForSites: true,
    });
    hud.showToast('显示已重置 · 0.50r / 100% / 范围模式');
  }

  /**
   * Bounding radius of what is actually on screen now: solid atoms (plus the
   * atom-xray shells outside the range) at the display scale, the cell
   * wireframe and visible site spheres. Used by "适应视图", reset view and
   * export framing, never by sliders.
   */
  function currentViewRadius(state: Readonly<AppState>): number {
    let radius = 0;
    const render = computeAtomRenderState(
      currentModel.atoms,
      state.displayMode,
      state.displayRange,
      state.atomHidden,
      state.ghostAtoms,
    );
    if (state.showAtoms) {
      for (let i = 0; i < currentModel.atoms.length; i++) {
        if (!render.rendered[i]) continue;
        const atom = currentModel.atoms[i];
        radius = Math.max(
          radius,
          Math.hypot(atom.position.x, atom.position.y, atom.position.z) +
            state.atomDisplayRadius * resolveAtomSize(state, atom.id),
        );
      }
    }
    if (state.showCell) radius = Math.max(radius, cellLayer.getBoundsRadius());

    if (state.showO || state.showT) {
      const sites = filterSites(
        currentModel.sites,
        state.showO,
        state.showT,
        state.siteFilter,
        state.selectedSiteId,
      ).filter(
        (site) =>
          !state.followRangeForSites ||
          isSiteVisibleInDisplay(
            site,
            currentModel,
            render.base,
            state.displayMode,
            state.displayRange,
            state.followRangeForSites,
          ),
      );
      for (const site of sites) {
        radius = Math.max(
          radius,
          Math.hypot(site.position.x, site.position.y, site.position.z) +
            site.maxRadius * state.siteScale * state.atomDisplayRadius,
        );
      }
    }

    return Math.max(radius, 1.5);
  }

  /**
   * Preset buttons re-frame after changing what is visible; dragging either
   * slider never does. The fit radius measures from the origin, so a stale
   * site focus is cleared before the camera target returns to origin.
   */
  function autoFitVisible(): void {
    if (store.state.focusedSiteId) store.set({ focusedSiteId: null });
    viewer.fitToVisible(currentViewRadius(store.state), 450);
  }

  function fitView(): void {
    viewer.fitView(currentViewRadius(store.state), 450);
    hud.showToast('已按当前可见内容适应视图');
  }

  function setAtomColors(ids: string[], hex: string): void {
    if (!isHexColor(hex)) return;
    const known = new Set(currentModel.atoms.map((atom) => atom.id));
    const valid = ids.filter((id) => known.has(id));
    if (valid.length === 0) return;
    const next = { ...store.state.atomColors };
    for (const id of valid) next[id] = normalizeHex(hex);
    store.set({ atomColors: next, allAtomColor: null });
  }

  function setAtomColor(id: string, hex: string): boolean {
    if (!isHexColor(hex)) return false;
    if (!currentModel.atoms.some((atom) => atom.id === id)) return false;
    setAtomColors([id], hex);
    return true;
  }

  function setAtomSizes(ids: string[], size: number): void {
    const known = new Set(currentModel.atoms.map((atom) => atom.id));
    const valid = ids.filter((id) => known.has(id));
    if (valid.length === 0) return;
    const value = clampAtomSize(size);
    const next = { ...store.state.atomSizes };
    for (const id of valid) next[id] = value;
    store.set({ atomSizes: next });
  }

  function hideAtoms(ids: string[]): void {
    const known = new Set(currentModel.atoms.map((atom) => atom.id));
    const valid = ids.filter((id) => known.has(id));
    if (valid.length === 0) return;
    const next = { ...store.state.atomHidden };
    for (const id of valid) next[id] = true;
    store.set({
      atomHidden: next,
      selectedAtomIds: store.state.selectedAtomIds.filter((id) => !valid.includes(id)),
    });
    hud.showToast(`已隐藏 ${valid.length} 个原子 · 可在控制台「显示全部隐藏」中找回`);
  }

  function showAllHiddenAtoms(): void {
    const count = Object.keys(store.state.atomHidden).length;
    if (count === 0) return;
    store.set({ atomHidden: {} });
    hud.showToast(`已恢复 ${count} 个隐藏原子`);
  }

  function restoreAtomEdits(ids: string[]): void {
    if (ids.length === 0) return;
    const colors = { ...store.state.atomColors };
    const sizes = { ...store.state.atomSizes };
    const hidden = { ...store.state.atomHidden };
    let removed = 0;
    for (const id of ids) {
      if (colors[id]) {
        delete colors[id];
        removed++;
      }
      if (sizes[id]) {
        delete sizes[id];
        removed++;
      }
      if (hidden[id]) {
        delete hidden[id];
        removed++;
      }
    }
    if (removed === 0) {
      hud.showToast('所选原子已是默认状态');
      return;
    }
    store.set({ atomColors: colors, atomSizes: sizes, atomHidden: hidden });
    hud.showToast(`已恢复 ${ids.length} 个原子的默认颜色 / 大小 / 可见性`);
  }

  function resetAllAtomEdits(): void {
    if (atomEditCount(store.state) === 0 && !store.state.allAtomColor) return;
    store.set({ atomColors: {}, atomSizes: {}, atomHidden: {}, allAtomColor: null });
    hud.showToast('已重置全部逐球编辑与统一配色');
  }

  /** Drop only the per-atom colour overrides, keeping sizes / hidden flags. */
  function clearAtomColors(): void {
    const count = Object.keys(store.state.atomColors).length;
    if (count === 0) {
      hud.showToast('没有逐个设置的颜色');
      return;
    }
    store.set({ atomColors: {} });
    hud.showToast(`已恢复 ${count} 个原子的默认颜色`);
  }

  /**
   * 1x1x1 / 2x2x2 conventional-cell toggle. Only the cluster size changes:
   * a/r (2sqrt2 for FCC, 4/sqrt3 for BCC), CN and APF stay those of one
   * conventional cell, so the scientific data structure is untouched.
   */
  function setCellRepeat(repeat: CellRepeat): void {
    const next: CellRepeat = repeat === 1 ? 1 : 2;
    if (next === store.state.cellRepeat) return;
    // Atom ids change with the cluster, so a stale selection/focus must clear.
    store.set({
      cellRepeat: next,
      selectedAtomIds: [],
      selectedSiteId: null,
      focusedSiteId: null,
    });
    hud.showToast(next === 1 ? '晶胞 1×1×1 · 常规晶胞' : '晶胞 2×2×2 · 超胞');
  }

  function setHcpCOverA(ratio: number, announce = false): void {
    const next = clampHcpCOverA(ratio);
    if (announce && Number.isFinite(ratio) && Math.abs(next - ratio) > 1e-9) {
      // Scientific guard: outside this interval neighbouring layers overlap.
      hud.showToast(
        `c/a 已限制在 ${HCP_MIN_C_OVER_A.toFixed(3)}–${HCP_MAX_C_OVER_A.toFixed(3)}（硬球不可重叠）`,
      );
    }
    if (Math.abs(next - store.state.hcpCOverA) < 1e-9) return;
    // A stale site focus would leave the orbit target off the new lattice.
    if (store.state.focusedSiteId) viewer.focusTarget(null, 0);
    store.set({ hcpCOverA: next, focusedSiteId: null });
  }

  const actions: PanelActions = {
    setStructure: switchStructure,
    setSiteType,
    enterSiteMode,
    showAllSites,
    selectSite: selectSiteById,
    focusSite,
    copySite,
    returnToCenter,
    resetView,
    fitView,
    setDisplayRadius,
    setDisplayRange,
    setDisplayMode,
    toggleDisplayMode,
    setFollowSites,
    resetDisplay,
    setAtomColor,
    setAtomColors,
    clearAtomColors,
    setAtomSizes,
    hideAtoms,
    showAllHiddenAtoms,
    restoreAtomEdits,
    resetAllAtomEdits,
    setHcpCOverA,
    setCellRepeat,
    clearAtomSelection: clearSelection,
  };
  panel = createPanel(store, actions, () => currentModel);

  function projectNdc(local: { x: number; y: number; z: number }): {
    x: number;
    y: number;
    z: number;
  } {
    viewer.root.updateMatrixWorld(true);
    const point = viewer.root.localToWorld(new Vector3(local.x, local.y, local.z));
    return point.project(viewer.camera);
  }

  function projectToScreen(local: { x: number; y: number; z: number }): {
    x: number;
    y: number;
    inView: boolean;
  } {
    const point = projectNdc(local);
    const rect = canvas.getBoundingClientRect();
    return {
      x: (point.x * 0.5 + 0.5) * rect.width,
      y: (-point.y * 0.5 + 0.5) * rect.height,
      inView: point.z > -1 && point.z < 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1,
    };
  }

  function selectedAtomsOf(state: Readonly<AppState>): Atom[] {
    if (state.selectedAtomIds.length === 0) return [];
    const wanted = new Set(state.selectedAtomIds);
    return currentModel.atoms.filter((atom) => wanted.has(atom.id));
  }

  function buildLabels(state: Readonly<AppState>): LabelSpec[] {
    const specs: LabelSpec[] = [];
    const visibility = computeAtomVisibility(
      currentModel.atoms,
      state.displayMode,
      state.displayRange,
    );
    if (state.displayMode === 'shell' && visibility.shell.centerAtom) {
      const anchor = projectToScreen(visibility.shell.centerAtom.position);
      if (anchor.inView) {
        specs.push({
          id: 'shell:center',
          text: `中心 · CN ${visibility.shell.coordination}`,
          accent: '#7FE7F5',
          compact: true,
          anchor,
        });
      }
    }
    const selected = selectedAtomsOf(state);
    if (selected.length === 1 && selected[0]) {
      const atom = selected[0];
      const anchor = projectToScreen(atom.position);
      if (anchor.inView) {
        specs.push({
          id: `atom:${atom.id}`,
          text: `M · ${atomKindLabel(atom.kind)}`,
          accent: '#F6C453',
          anchor,
        });
      }
    } else if (selected.length > 1 && selected[0]) {
      const primary = selected[0];
      const anchor = projectToScreen(primary.position);
      if (anchor.inView) {
        specs.push({
          id: 'atom:multi',
          text: `已选 ${selected.length} 个原子`,
          accent: '#7FE7F5',
          anchor,
        });
      }
    }

    const site = state.selectedSiteId
      ? currentModel.sites.find((candidate) => candidate.id === state.selectedSiteId)
      : null;
    if (site) {
      const anchor = projectToScreen(site.position);
      const neighborsVisible = siteNeighborsFullyVisible(site, visibility.visible);
      if (anchor.inView) {
        specs.push({
          id: `site:${site.id}`,
          text: `${site.type === 'O' ? 'OCT' : 'TET'} · ${site.coordination}/${site.expectedCoordination}${
            neighborsVisible ? (site.complete ? '' : ' · 边界') : ' · 配位原子在范围外'
          }`,
          accent: SITE_COLORS[site.type],
          anchor,
        });
      }
    }

    if (state.showSiteLabels) {
      const visible = filterSites(
        currentModel.sites,
        state.showO,
        state.showT,
        state.siteFilter,
        state.selectedSiteId,
      )
        .filter((candidate) => candidate.id !== site?.id)
        .sort((a, b) => {
          if (a.complete !== b.complete) return a.complete ? -1 : 1;
          if (a.type !== b.type) return a.type === 'O' ? -1 : 1;
          return a.fractional.x - b.fractional.x || a.fractional.y - b.fractional.y;
        })
        .slice(0, Math.max(0, 24 - specs.length));

      for (const candidate of visible) {
        const anchor = projectToScreen(candidate.position);
        if (!anchor.inView) continue;
        specs.push({
          id: `all:${candidate.id}`,
          text: `${candidate.type === 'O' ? 'OCT' : 'TET'} ${fracText(candidate.fractional.x, candidate.fractional.y, candidate.fractional.z, 2)}`,
          accent: SITE_COLORS[candidate.type],
          compact: true,
          anchor,
        });
      }
    }
    return specs;
  }

  function labelsShouldShow(state: Readonly<AppState>): boolean {
    if (state.displayMode === 'shell') return true;
    if (state.autoRotate && state.selectedAtomIds.length === 0 && !state.selectedSiteId) return false;
    return true;
  }

  function refreshLabels(state: Readonly<AppState>): void {
    labels.setLabels(buildLabels(state));
    labels.setVisible(labelsShouldShow(state));
  }

  function applyScene(state: Readonly<AppState>): void {
    const render = computeAtomRenderState(
      currentModel.atoms,
      state.displayMode,
      state.displayRange,
      state.atomHidden,
      state.ghostAtoms,
    );
    const sizes = currentModel.atoms.map((atom) => resolveAtomSize(state, atom.id));
    const shell = computeAtomVisibility(currentModel.atoms, state.displayMode, state.displayRange).shell;
    atomLayer.setColors(
      currentModel.atoms.map((atom) => resolveAtomColor(atom, currentModel.meta, state)),
    );
    atomLayer.setDisplay(render.solid, render.xray, state.atomDisplayRadius, sizes);
    atomLayer.setVisible(state.showAtoms);
    const selectedIndices = state.selectedAtomIds
      .map((id) => currentModel.atoms.findIndex((atom) => atom.id === id))
      .filter((index) => index >= 0);
    atomLayer.setSelection(selectedIndices);
    atomLayer.setShellCenter(state.displayMode === 'shell' ? shell.centerIndex : null);

    const cellStyle = resolveCellStyle(state);
    cellLayer.setVisible(state.showCell);
    cellLayer.setDisplayRadius(state.atomDisplayRadius);
    cellLayer.setAtomVisibility(render.rendered);
    cellLayer.setStyle(cellStyle.width, cellStyle.brightness);
    cellLayer.setXray(state.cellXray);

    shellLayer.update(
      currentModel,
      shell,
      state.displayMode === 'shell' && state.showPolyhedron,
    );
    const siteAtomVisible = render.base.map(
      (value, index) => value && state.atomHidden[currentModel.atoms[index]?.id ?? ''] !== true,
    );
    siteLayer.update({
      showO: state.showO,
      showT: state.showT,
      filter: state.siteFilter,
      selectedSiteId: state.selectedSiteId,
      scale: state.siteScale,
      displayScale: state.atomDisplayRadius,
      opacity: state.siteOpacity,
      atomVisible: siteAtomVisible,
      displayMode: state.displayMode,
      displayRange: state.displayRange,
      followRange: state.followRangeForSites,
    });
    const selectedSite = state.selectedSiteId
      ? currentModel.sites.find((site) => site.id === state.selectedSiteId) ?? null
      : null;
    siteLayer.setSelectedSite(selectedSite, state.showPolyhedron, state.showBonds);

    refreshLabels(state);
    viewer.setAutoRotate(state.autoRotate);
    viewer.setAutoRotateSpeed(state.autoRotateSpeed);
    viewer.setSelectionPaused(
      Boolean(
        state.selectedAtomIds.length > 0 ||
          state.selectedSiteId ||
          state.focusedSiteId ||
          state.displayMode === 'shell',
      ),
    );

    updateDock(state, render);
    updateAtomCard(state);

    const legendO = document.getElementById('legend-o-row');
    const legendT = document.getElementById('legend-t-row');
    const legendGhost = document.getElementById('legend-ghost-row');
    if (legendO) legendO.hidden = !state.showO;
    if (legendT) legendT.hidden = !state.showT;
    if (legendGhost) legendGhost.hidden = render.xrayCount === 0;

    canvas.classList.toggle('is-editing', state.editMode);

    const theme = resolveBackground(state.background, state.customBg);
    const stage = must<HTMLElement>('stage');
    stage.style.setProperty('--bg-a', theme.a);
    stage.style.setProperty('--bg-b', theme.b);
    stage.style.setProperty('--bg-c', theme.c);
    stage.style.setProperty('--glow-1', theme.glow1);
    stage.style.setProperty('--glow-2', theme.glow2);
    stage.style.setProperty('--grid-line', theme.grid);
  }

  function sync(state: Readonly<AppState>): void {
    applyScene(state);
    panel?.update(state);
    hud.update(state, currentModel);
  }

  function rebuildScene(duration: number, keepOrientation = false): void {
    currentModel = modelFor(store.state.structure);
    viewer.setFrameRadius(frameRadiusFor(store.state.cellRepeat));
    atomLayer.build(currentModel);
    cellLayer.build(currentModel);
    cellLayer.setResolution(canvas.clientWidth, canvas.clientHeight);
    siteLayer.build(currentModel);
    shellLayer.build(currentModel);
    shellLayer.setResolution(canvas.clientWidth, canvas.clientHeight);
    labels.clear();
    hud.hideTooltip();
    atomLayer.setHover(null);
    const radius = currentViewRadius(store.state);
    if (keepOrientation) {
      // The HCP c/a sandbox changes geometry without touching how the user is
      // looking at it, so keep the orbit direction and only re-fit the zoom.
      viewer.fitView(radius, duration);
    } else {
      viewer.resetViewToFit(radius, duration);
    }
  }

  function visibleSiteIds(state: Readonly<AppState>): Set<string> {
    const visibility = computeAtomVisibility(currentModel.atoms, state.displayMode, state.displayRange);
    return new Set(
      visibleSitesInDisplay(
        currentModel,
        visibility.visible,
        state.displayMode,
        state.displayRange,
        state.followRangeForSites,
      )
        .filter((site) => {
          if (site.type === 'O' && !state.showO) return false;
          if (site.type === 'T' && !state.showT) return false;
          if (state.siteFilter === 'complete' && !site.complete) return false;
          if (state.siteFilter === 'selected' && site.id !== state.selectedSiteId) return false;
          return true;
        })
        .map((site) => site.id),
    );
  }

  store.subscribe((state, patch) => {
    if (patch.structure) rebuildScene(reducedMotion ? 0 : 450);
    if (patch.cellRepeat !== undefined) rebuildScene(reducedMotion ? 0 : 350);
    if (patch.hcpCOverA !== undefined && state.structure === 'hcp') {
      // Scientific sandbox: recompute the HCP lattice in place, then keep the
      // orbit direction and re-fit the zoom (never silently reset the camera).
      rebuildScene(reducedMotion ? 0 : 120, true);
    }
    if (
      patch.structure ||
      patch.cellRepeat !== undefined ||
      patch.hcpCOverA !== undefined ||
      patch.showO === false ||
      patch.showT === false ||
      patch.showAtoms === false ||
      patch.siteFilter !== undefined ||
      patch.displayMode !== undefined ||
      patch.displayRange !== undefined ||
      patch.atomDisplayRadius !== undefined ||
      patch.followRangeForSites !== undefined
    ) {
      hud.hideTooltip();
      atomLayer.setHover(null);
    }

    const knownAtoms = new Set(currentModel.atoms.map((atom) => atom.id));
    const validSelection = state.selectedAtomIds.filter((id) => knownAtoms.has(id));
    if (validSelection.length !== state.selectedAtomIds.length) {
      store.set({ selectedAtomIds: validSelection });
      return;
    }
    if (state.selectedSiteId && !visibleSiteIds(state).has(state.selectedSiteId)) {
      const hadFocus = Boolean(state.focusedSiteId);
      store.set({
        selectedSiteId: null,
        focusedSiteId: null,
        siteFilter: state.siteFilter === 'selected' ? 'all' : state.siteFilter,
      });
      if (hadFocus) viewer.focusTarget(null, 350);
      return;
    }
    sync(state);
  });

  // persistent corner menu (常驻菜单) + color popover -----------------
  type DockPopoverKind = 'color' | 'range' | 'bg' | null;
  type ColorMode = AppState['colorMode'];
  type DockPopoverTrigger = Exclude<DockPopoverKind, null>;
  let dockPopover: DockPopoverKind = null;
  const popoverEl = must<HTMLElement>('qd-popover');
  const dockEl = must<HTMLElement>('quick-dock');

  const DOCK_POPOVER_TRIGGERS: Record<DockPopoverTrigger, string> = {
    color: 'qd-color',
    range: 'qd-range',
    bg: 'qd-bg',
  };

  const COLOR_MODE_LABELS: { id: ColorMode; label: string }[] = [
    { id: 'radial', label: '内外层' },
    { id: 'stacking', label: '堆垛层' },
    { id: 'gold', label: '纯金' },
  ];

  function byIdOptional<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
  }

  function closeDockPopover(): boolean {
    if (!dockPopover) return false;
    const trigger = DOCK_POPOVER_TRIGGERS[dockPopover];
    dockPopover = null;
    popoverEl.hidden = true;
    popoverEl.innerHTML = '';
    byIdOptional(trigger)?.setAttribute('aria-expanded', 'false');
    return true;
  }

  function colorPopoverMarkup(): string {
    const state = store.state;
    const uniform = state.allAtomColor;
    const dot = (hex: string) => `<i class="qd-dot" style="background:${hex}"></i>`;
    const modes = COLOR_MODE_LABELS.map(
      (mode) =>
        `<button class="qd-mode" type="button" data-qd-mode="${mode.id}" aria-pressed="${state.colorMode === mode.id}">${mode.label}</button>`,
    ).join('');
    return `
      <div class="qd-pop-head"><span>所有小球颜色</span><button class="qd-pop-close" type="button" id="qd-pop-close" aria-label="关闭">${icon('close', 14)}</button></div>
      <div class="qd-pop-modes" role="group" aria-label="配色模式">${modes}</div>
      <label class="qd-pop-row" for="qd-color-inner"><span class="qd-pop-key">${dot(state.colorInner)}内层（古铜）</span><input type="color" id="qd-color-inner" value="${state.colorInner}" aria-label="内层颜色"></label>
      <label class="qd-pop-row" for="qd-color-outer"><span class="qd-pop-key">${dot(state.colorOuter)}外层（金色）</span><input type="color" id="qd-color-outer" value="${state.colorOuter}" aria-label="外层颜色"></label>
      <label class="qd-pop-row" for="qd-color-input"><span>统一色</span><input type="color" id="qd-color-input" value="${uniform ?? state.colorOuter}" aria-label="统一色"></label>
      <div class="btn-row">
        <button class="btn-small" id="qd-color-reset" type="button">恢复默认配色</button>
        <button class="btn-small" id="qd-color-clear" type="button"${uniform ? '' : ' disabled'}>取消统一色</button>
      </div>
      <p class="qd-pop-note">内外层按径向 ${RADIAL_SPLIT.toFixed(2)}R 划分（外层金色 / 内层古铜）；逐球自定义颜色始终优先，统一色会覆盖内外层与堆垛层。</p>`;
  }

  function rangePopoverMarkup(): string {
    const state = store.state;
    const percent = Math.round(state.displayRange * 100);
    const allOn = state.displayMode === 'all';
    const shellOn = state.displayMode === 'shell';
    return `
      <div class="qd-pop-head"><span>显示范围</span><button class="qd-pop-close" type="button" id="qd-pop-close" aria-label="关闭">${icon('close', 14)}</button></div>
      <div class="range-row">
        <label for="qd-range-input">显示范围 <output id="qd-range-out">${percent}%</output></label>
        <input type="range" id="qd-range-input" min="40" max="100" step="1" value="${percent}">
      </div>
      <div class="btn-row">
        <button class="btn-small" id="qd-range-tangent" type="button">相切硬球 100%</button>
        <button class="btn-small" id="qd-range-shrink" type="button">缩球 0.50r</button>
      </div>
      <div class="btn-row">
        <button class="btn-small${allOn ? ' is-on' : ''}" id="qd-range-all" type="button" aria-pressed="${allOn}">${allOn ? '关闭显示全部' : '显示全部'}</button>
        <button class="btn-small${shellOn ? ' is-on' : ''}" id="qd-range-shell" type="button" aria-pressed="${shellOn}">${shellOn ? '关闭配位壳' : '配位壳'}</button>
      </div>
      <p class="qd-pop-note">范围外的球体不会消失，而是切换为「原子透视」；范围越小，透视层越薄。</p>`;
  }

  function bgPopoverMarkup(): string {
    const state = store.state;
    const presets = [
      { id: 'deep', label: '深空蓝', hint: 'DEEP' },
      { id: 'aurora', label: '极光青', hint: 'AURORA' },
      { id: 'gold', label: '黑金', hint: 'BLACK GOLD' },
    ];
    const buttons = presets
      .map(
        (preset) =>
          `<button class="bg-preset${state.background === preset.id ? ' is-active' : ''}" type="button" data-qd-bg="${preset.id}" aria-pressed="${state.background === preset.id}"><span class="bg-swatch ${preset.id}"></span><span>${preset.label}</span><em>${preset.hint}</em></button>`,
      )
      .join('');
    return `
      <div class="qd-pop-head"><span>背景</span><button class="qd-pop-close" type="button" id="qd-pop-close" aria-label="关闭">${icon('close', 14)}</button></div>
      <div class="bg-presets qd-pop-bg" role="group" aria-label="背景预设">${buttons}</div>
      <label class="qd-pop-row" for="qd-bg-custom"><span class="qd-pop-key">自定义底色</span><span class="color-control"><input type="color" id="qd-bg-custom" value="${state.customBg}" aria-label="自定义背景颜色"><em id="qd-bg-hex">${state.customBg}</em></span></label>
      <p class="qd-pop-note">背景仅作用于页面；导出动画使用透明 alpha 通道，不包含此底色。</p>`;
  }

  function dockPopoverMarkup(kind: DockPopoverTrigger): string {
    if (kind === 'range') return rangePopoverMarkup();
    if (kind === 'bg') return bgPopoverMarkup();
    return colorPopoverMarkup();
  }

  function refreshDockPopover(): void {
    if (!dockPopover) return;
    popoverEl.innerHTML = dockPopoverMarkup(dockPopover);
    bindDockPopover();
  }

  function bindDockPopover(): void {
    byIdOptional('qd-pop-close')?.addEventListener('click', () => closeDockPopover());
    if (dockPopover === 'range') {
      bindRangePopover();
      return;
    }
    if (dockPopover === 'bg') {
      bindBgPopover();
      return;
    }
    for (const button of popoverEl.querySelectorAll<HTMLButtonElement>('[data-qd-mode]')) {
      button.addEventListener('click', () => {
        store.set({ colorMode: button.dataset.qdMode as ColorMode, allAtomColor: null });
        refreshDockPopover();
      });
    }
    const inner = byIdOptional<HTMLInputElement>('qd-color-inner');
    inner?.addEventListener('input', () => {
      store.set({ colorInner: inner.value.toUpperCase(), allAtomColor: null });
    });
    const outer = byIdOptional<HTMLInputElement>('qd-color-outer');
    outer?.addEventListener('input', () => {
      store.set({ colorOuter: outer.value.toUpperCase(), allAtomColor: null });
    });
    const uniform = byIdOptional<HTMLInputElement>('qd-color-input');
    uniform?.addEventListener('input', () => {
      store.set({ allAtomColor: uniform.value.toUpperCase() });
    });
    byIdOptional('qd-color-reset')?.addEventListener('click', () => {
      store.set({
        colorInner: DEFAULT_COLOR_INNER,
        colorOuter: DEFAULT_COLOR_OUTER,
        colorMode: 'radial',
        allAtomColor: null,
      });
      refreshDockPopover();
      hud.showToast('已恢复默认配色：外层金色 / 内层古铜');
    });
    byIdOptional('qd-color-clear')?.addEventListener('click', () => {
      store.set({ allAtomColor: null });
      refreshDockPopover();
    });
  }

  function bindRangePopover(): void {
    const input = byIdOptional<HTMLInputElement>('qd-range-input');
    input?.addEventListener('input', () => {
      setDisplayRange(Number(input.value) / 100);
      const out = byIdOptional<HTMLElement>('qd-range-out');
      if (out) out.textContent = `${input.value}%`;
    });
    byIdOptional('qd-range-tangent')?.addEventListener('click', () => {
      setDisplayRadius(1, true);
      refreshDockPopover();
      hud.showToast('相切硬球 · 显示半径 1.00r');
    });
    byIdOptional('qd-range-shrink')?.addEventListener('click', () => {
      setDisplayRadius(0.5);
      refreshDockPopover();
    });
    byIdOptional('qd-range-all')?.addEventListener('click', () => {
      toggleDisplayMode('all');
      refreshDockPopover();
    });
    byIdOptional('qd-range-shell')?.addEventListener('click', () => {
      toggleDisplayMode('shell');
      refreshDockPopover();
    });
  }

  function bindBgPopover(): void {
    for (const button of popoverEl.querySelectorAll<HTMLButtonElement>('[data-qd-bg]')) {
      button.addEventListener('click', () => {
        store.set({ background: button.dataset.qdBg as AppState['background'] });
        refreshDockPopover();
      });
    }
    const custom = byIdOptional<HTMLInputElement>('qd-bg-custom');
    custom?.addEventListener('input', () => {
      store.set({ background: 'custom', customBg: custom.value.toUpperCase() });
    });
  }

  function openDockPopover(kind: DockPopoverTrigger = 'color'): void {
    if (dockPopover === kind) {
      closeDockPopover();
      return;
    }
    if (dockPopover) {
      byIdOptional(DOCK_POPOVER_TRIGGERS[dockPopover])?.setAttribute('aria-expanded', 'false');
    }
    dockPopover = kind;
    popoverEl.innerHTML = dockPopoverMarkup(kind);
    popoverEl.hidden = false;
    bindDockPopover();
    byIdOptional(DOCK_POPOVER_TRIGGERS[kind])?.setAttribute('aria-expanded', 'true');
    if (kind === 'color') {
      popoverEl.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    }
  }

  function updateDock(state: Readonly<AppState>, render: AtomRenderState): void {
    const setToggle = (id: string, on: boolean) => {
      const el = byIdOptional(id);
      el?.setAttribute('aria-checked', String(on));
      el?.classList.toggle('is-on', on);
    };
    setToggle('qd-xray', state.cellXray);
    setToggle('qd-ghost', state.ghostAtoms);
    setToggle('qd-atoms', state.showAtoms);
    setToggle('qd-cell', state.showCell);
    // Quick "restore default colour" switch: it only appears while per-atom
    // colour overrides exist, so it never takes dock space needlessly.
    const restoreColor = byIdOptional<HTMLButtonElement>('qd-color-restore');
    if (restoreColor) {
      const edited = Object.keys(state.atomColors).length;
      restoreColor.hidden = edited === 0;
      const restoreCount = byIdOptional<HTMLElement>('qd-color-restore-count');
      if (restoreCount) restoreCount.textContent = String(edited);
    }
    const swatch = byIdOptional('qd-swatch');
    if (swatch) {
      swatch.style.background = state.allAtomColor
        ? state.allAtomColor
        : `linear-gradient(135deg, ${state.colorInner} 0 48%, ${state.colorOuter} 52% 100%)`;
    }
    const status = byIdOptional('qd-status');
    if (status) {
      status.textContent = `${state.atomDisplayRadius.toFixed(2)}r · 范围 ${Math.round(
        state.displayRange * 100,
      )}% · 实心 ${render.solidCount} · 透视 ${render.xrayCount}`;
    }
    // Open popovers are patched in place, never re-rendered while dragging:
    // re-rendering would drop the active slider / colour picker.
    if (dockPopover === 'range') {
      const percent = Math.round(state.displayRange * 100);
      const rangeInput = byIdOptional<HTMLInputElement>('qd-range-input');
      if (rangeInput && document.activeElement !== rangeInput) rangeInput.value = String(percent);
      const rangeOut = byIdOptional<HTMLElement>('qd-range-out');
      if (rangeOut) rangeOut.textContent = `${percent}%`;
      const allOn = state.displayMode === 'all';
      const allBtn = byIdOptional<HTMLButtonElement>('qd-range-all');
      if (allBtn) {
        allBtn.textContent = allOn ? '关闭显示全部' : '显示全部';
        allBtn.setAttribute('aria-pressed', String(allOn));
        allBtn.classList.toggle('is-on', allOn);
      }
      const shellOn = state.displayMode === 'shell';
      const shellBtn = byIdOptional<HTMLButtonElement>('qd-range-shell');
      if (shellBtn) {
        shellBtn.textContent = shellOn ? '关闭配位壳' : '配位壳';
        shellBtn.setAttribute('aria-pressed', String(shellOn));
        shellBtn.classList.toggle('is-on', shellOn);
      }
    }
    if (dockPopover === 'bg') {
      for (const button of popoverEl.querySelectorAll<HTMLButtonElement>('[data-qd-bg]')) {
        const active = button.dataset.qdBg === state.background;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }
      const bgCustom = byIdOptional<HTMLInputElement>('qd-bg-custom');
      if (bgCustom && document.activeElement !== bgCustom) bgCustom.value = state.customBg;
      const bgHex = byIdOptional<HTMLElement>('qd-bg-hex');
      if (bgHex) bgHex.textContent = state.customBg;
    }
    if (dockPopover === 'color') {
      const syncColor = (id: string, value: string) => {
        const input = byIdOptional<HTMLInputElement>(id);
        if (input && document.activeElement !== input) input.value = value;
      };
      syncColor('qd-color-inner', state.colorInner);
      syncColor('qd-color-outer', state.colorOuter);
      syncColor('qd-color-input', state.allAtomColor ?? state.colorOuter);
      const dots = popoverEl.querySelectorAll<HTMLElement>('.qd-dot');
      if (dots[0]) dots[0].style.background = state.colorInner;
      if (dots[1]) dots[1].style.background = state.colorOuter;
      for (const button of popoverEl.querySelectorAll<HTMLButtonElement>('[data-qd-mode]')) {
        button.setAttribute('aria-pressed', String(button.dataset.qdMode === state.colorMode));
      }
      const clear = byIdOptional<HTMLButtonElement>('qd-color-clear');
      if (clear) clear.disabled = !state.allAtomColor;
    }
  }

  function updateAtomCard(state: Readonly<AppState>): void {
    const card = byIdOptional<HTMLElement>('atom-card');
    if (!card) return;
    const selected = selectedAtomsOf(state);
    if (selected.length === 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const primary = selected[0];
    byIdOptional<HTMLElement>('atom-card-count')!.textContent = String(selected.length);
    byIdOptional<HTMLElement>('atom-card-meta')!.textContent =
      selected.length > 1
        ? `多选 · ${currentModel.meta.abbreviation} · 混合晶位`
        : `${currentModel.meta.abbreviation} · ${atomKindLabel(primary.kind)} · ${atomLayerLabel(primary, state.structure)}`;
    const colorInput = byIdOptional<HTMLInputElement>('atom-card-color');
    const sizeInput = byIdOptional<HTMLInputElement>('atom-card-size');
    const sizeOut = byIdOptional<HTMLElement>('atom-card-size-out');
    const active = document.activeElement;
    if (colorInput && active !== colorInput) {
      colorInput.value = resolveAtomColor(primary, currentModel.meta, state);
    }
    if (sizeInput && active !== sizeInput) {
      const size = Math.round(resolveAtomSize(state, primary.id) * 100);
      sizeInput.value = String(size);
      if (sizeOut) sizeOut.textContent = `${size}%`;
    }
    const hideBtn = byIdOptional<HTMLButtonElement>('atom-card-hide');
    if (hideBtn) hideBtn.textContent = `隐藏所选 (${selected.length})`;
  }

  // persistent corner menu wiring ------------------------------------
  byIdOptional('qd-reset')?.addEventListener('click', resetView);
  byIdOptional('qd-fit')?.addEventListener('click', fitView);
  byIdOptional('qd-color')?.addEventListener('click', () => openDockPopover('color'));
  byIdOptional('qd-range')?.addEventListener('click', () => openDockPopover('range'));
  byIdOptional('qd-bg')?.addEventListener('click', () => openDockPopover('bg'));
  byIdOptional('qd-cell')?.addEventListener('click', () => {
    store.set({ showCell: !store.state.showCell });
  });
  byIdOptional('qd-export')?.addEventListener('click', () => {
    byIdOptional<HTMLButtonElement>('export-btn')?.click();
  });
  byIdOptional('qd-color-restore')?.addEventListener('click', () => {
    clearAtomColors();
  });
  byIdOptional('qd-xray')?.addEventListener('click', () => {
    store.set({ cellXray: !store.state.cellXray });
  });
  byIdOptional('qd-ghost')?.addEventListener('click', () => {
    store.set({ ghostAtoms: !store.state.ghostAtoms });
  });
  byIdOptional('qd-atoms')?.addEventListener('click', () => {
    store.set({ showAtoms: !store.state.showAtoms });
  });
  document.addEventListener('pointerdown', (event) => {
    if (!dockPopover) return;
    const target = event.target as Node | null;
    if (target && dockEl.contains(target)) return;
    closeDockPopover();
  });

  // floating atom inspector wiring ----------------------------------
  byIdOptional('atom-card-clear')?.addEventListener('click', clearSelection);
  byIdOptional<HTMLInputElement>('atom-card-color')?.addEventListener('input', (event) => {
    const ids = store.state.selectedAtomIds;
    if (ids.length === 0) return;
    setAtomColors(ids, (event.target as HTMLInputElement).value.toUpperCase());
  });
  byIdOptional('atom-card-color-default')?.addEventListener('click', () => {
    const ids = store.state.selectedAtomIds;
    if (ids.length === 0) return;
    const next = { ...store.state.atomColors };
    for (const id of ids) delete next[id];
    store.set({ atomColors: next });
    hud.showToast('已恢复所选原子的默认颜色');
  });
  const cardSizeInput = byIdOptional<HTMLInputElement>('atom-card-size');
  cardSizeInput?.addEventListener('input', () => {
    const ids = store.state.selectedAtomIds;
    if (ids.length === 0) return;
    setAtomSizes(ids, Number(cardSizeInput.value) / 100);
    const out = byIdOptional<HTMLElement>('atom-card-size-out');
    if (out) out.textContent = `${cardSizeInput.value}%`;
  });
  byIdOptional('atom-card-hide')?.addEventListener('click', () => {
    hideAtoms(store.state.selectedAtomIds);
  });
  byIdOptional('atom-card-restore')?.addEventListener('click', () => {
    restoreAtomEdits(store.state.selectedAtomIds);
  });

  function ndcFrom(clientX: number, clientY: number): Vector2 {
    const rect = canvas.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    return ndc;
  }

  function atomAt(clientX: number, clientY: number): Atom | null {
    if (!store.state.showAtoms) return null;
    const targets = atomLayer.pickTargets;
    if (targets.length === 0) return null;
    const hits = viewer.pick(ndcFrom(clientX, clientY), targets);
    for (const hit of hits) {
      if (hit.instanceId === undefined) continue;
      // Solid atoms win over atom-xray shells because the solid layer is first
      // in the pick-target list; both are selectable so the range-hidden shell
      // stays editable.
      if (!atomLayer.isRenderedIndex(hit.instanceId)) continue;
      return currentModel.atoms[hit.instanceId] ?? null;
    }
    return null;
  }

  function siteAt(clientX: number, clientY: number): InterstitialSite | null {
    const targets = siteLayer.pickTargets;
    if (targets.length === 0) return null;
    const hits = viewer.pick(ndcFrom(clientX, clientY), targets);
    for (const hit of hits) {
      if (hit.instanceId === undefined) continue;
      const site = siteLayer.getSiteForPick(hit.object, hit.instanceId);
      if (site) return site;
    }
    return null;
  }

  function updateHover(clientX: number, clientY: number): void {
    const state = store.state;
    const site = siteAt(clientX, clientY);
    if (site) {
      atomLayer.setHover(null);
      labels.setVisible(false);
      canvas.classList.add('is-pointing');
      const shape = siteShapeLabel(site, state.structure);
      const visibility = computeAtomVisibility(currentModel.atoms, state.displayMode, state.displayRange);
      const neighborsVisible = siteNeighborsFullyVisible(site, visibility.visible);
      hud.showTooltip(
        {
          tag: `${site.type} · ${shape}${
            neighborsVisible ? (site.complete ? '' : ' · 边界欠配位') : ' · 配位原子在范围外'
          }`,
          frac: fracText(site.fractional.x, site.fractional.y, site.fractional.z),
          meta: `${siteCoordinationLabel(site)} · r/R ${site.maxRadius.toFixed(3)}`,
        },
        clientX,
        clientY,
      );
      return;
    }

    canvas.classList.remove('is-pointing');
    const atom = atomAt(clientX, clientY);
    if (atom) {
      const index = currentModel.atoms.indexOf(atom);
      atomLayer.setHover(index);
      labels.setVisible(false);
      canvas.classList.add('is-pointing');
      const override = state.atomColors[atom.id];
      const sizeOverride = state.atomSizes[atom.id];
      const isSelected = state.selectedAtomIds.includes(atom.id);
      let avoid: DOMRect | null = null;
      if (isSelected) {
        const diameter = atomScreenDiameter(index) ?? 100;
        const point = screenPosition(atom.position);
        avoid = new DOMRect(
          point.x - diameter * 0.8,
          point.y - diameter * 0.8,
          diameter * 1.6,
          diameter * 1.6,
        );
      }
      hud.showTooltip(
        {
          tag: `M · ${atomKindLabel(atom.kind)} · ${currentModel.meta.abbreviation}`,
          frac: fracText(atom.fractional.x, atom.fractional.y, atom.fractional.z, 4),
          meta: `${atomLayerLabel(atom, state.structure)}${
            override ? ' · 自定义颜色' : ''
          }${sizeOverride ? ` · 大小 ${Math.round(sizeOverride * 100)}%` : ''}${
            isSelected ? ' · 已选中' : ' · 单击选中 / Ctrl+单击多选'
          }`,
        },
        clientX,
        clientY,
        avoid,
      );
    } else {
      atomLayer.setHover(null);
      hud.hideTooltip();
      labels.setVisible(labelsShouldShow(state));
      canvas.classList.remove('is-pointing');
    }
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    labels.setVisible(false);
    pointerDown = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!pointerDown || pointerDown.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown = null;
    if (distance > 4) {
      refreshLabels(store.state);
      return;
    }

    const site = siteAt(event.clientX, event.clientY);
    if (site) {
      selectSite(site);
      return;
    }
    const atom = atomAt(event.clientX, event.clientY);
    if (atom) {
      selectAtom(atom, event.ctrlKey || event.metaKey || event.shiftKey);
      return;
    }
    closeDockPopover();
    if (store.state.selectedAtomIds.length > 0 || store.state.selectedSiteId || store.state.focusedSiteId) {
      clearSelection();
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    updateHover(event.clientX, event.clientY);
  }

  function handlePointerLeave(): void {
    atomLayer.setHover(null);
    hud.hideTooltip();
    labels.setVisible(labelsShouldShow(store.state));
    canvas.classList.remove('is-pointing');
  }

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  canvas.addEventListener('pointercancel', () => {
    pointerDown = null;
    refreshLabels(store.state);
  });

  // keyboard --------------------------------------------------------
  window.addEventListener('keydown', (event) => {
    if (dialog.isOpen() || isEditableTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'Escape') {
      if (closeDockPopover()) return;
      if (panel?.isSheetOpen()) panel.closeSheet();
      else clearSelection();
      return;
    }
    if (event.code === 'Space') {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'BUTTON' || tag === 'A') return;
      event.preventDefault();
      store.set({ autoRotate: !store.state.autoRotate });
      return;
    }
    if (event.key === '1' || event.key === '2' || event.key === '3') {
      const id = event.key === '1' ? 'fcc' : event.key === '2' ? 'bcc' : 'hcp';
      switchStructure(id);
      hud.focusStructureCard(id);
    } else if (event.key === 'r' || event.key === 'R') resetView();
  });

  // export ----------------------------------------------------------
  function runExport(options: ExportOptions, hooks: ExportHooks): Promise<ExportResult> {
    return runExportSession(
      {
        viewer,
        fitRadius: currentViewRadius(store.state),
        prepare: (size, includePolyhedron) => {
          atomLayer.setExportMode(true);
          labels.setVisible(false);
          siteLayer.setSelectionVisible(includePolyhedron, false);
          cellLayer.setResolution(size, size);
          shellLayer.setResolution(size, size);
        },
        restore: () => {
          atomLayer.setExportMode(false);
          siteLayer.setSelectionVisible(true, true);
          cellLayer.setResolution(
            Math.max(1, canvas.clientWidth),
            Math.max(1, canvas.clientHeight),
          );
          shellLayer.setResolution(
            Math.max(1, canvas.clientWidth),
            Math.max(1, canvas.clientHeight),
          );
          refreshLabels(store.state);
        },
      },
      options,
      hooks,
    );
  }

  // top bar ---------------------------------------------------------
  must<HTMLButtonElement>('auto-rotate-toggle').addEventListener('click', () => {
    store.set({ autoRotate: !store.state.autoRotate });
  });
  window.addEventListener('resize', () => {
    cellLayer.setResolution(canvas.clientWidth, canvas.clientHeight);
    shellLayer.setResolution(canvas.clientWidth, canvas.clientHeight);
    hud.update(store.state, currentModel);
    window.setTimeout(() => refreshLabels(store.state), 80);
  });
  viewer.onSettle(() => refreshLabels(store.state));

  // debug -----------------------------------------------------------
  const debug: DebugApi = {
    getState: () => {
      const state = store.state;
      return {
        structure: state.structure,
        cellRepeat: state.cellRepeat,
        colorMode: state.colorMode,
        colorInner: state.colorInner,
        colorOuter: state.colorOuter,
        selectedAtomId: state.selectedAtomIds[0] ?? null,
        selectedAtomIds: state.selectedAtomIds.slice(),
        selectedSiteId: state.selectedSiteId,
        focusedSiteId: state.focusedSiteId,
        editMode: state.editMode,
        autoRotate: state.autoRotate,
        autoRotateSpeed: state.autoRotateSpeed,
        showCell: state.showCell,
        cellXray: state.cellXray,
        cellLineWidth: state.cellLineWidth,
        cellLineBrightness: state.cellLineBrightness,
        cellStyleAuto: state.cellStyleAuto,
        ghostAtoms: state.ghostAtoms,
        showAtoms: state.showAtoms,
        atomDisplayRadius: state.atomDisplayRadius,
        displayRange: state.displayRange,
        displayMode: state.displayMode,
        followRangeForSites: state.followRangeForSites,
        showO: state.showO,
        showT: state.showT,
        siteScale: state.siteScale,
        siteOpacity: state.siteOpacity,
        siteFilter: state.siteFilter,
        siteBrowserType: state.siteBrowserType,
        atomColors: { ...state.atomColors },
        atomHidden: { ...state.atomHidden },
        atomSizes: { ...state.atomSizes },
        allAtomColor: state.allAtomColor,
        hcpCOverA: state.hcpCOverA,
        background: state.background,
      };
    },
    setStructure: (id) => {
      if (!STRUCTURE_IDS.includes(id)) return false;
      switchStructure(id);
      return true;
    },
    selectAtomByIndex: (index) => {
      const atom = currentModel.atoms[index];
      if (!atom) return false;
      selectAtom(atom);
      return true;
    },
    setAtomColor,
    getSelectedAtomIds: () => store.state.selectedAtomIds.slice(),
    setAtomHidden: (ids, hidden) => {
      if (hidden) hideAtoms(ids);
      else restoreAtomEdits(ids);
    },
    setAtomSize: (ids, size) => setAtomSizes(ids, size),
    clearSelection: () => clearSelection(),
    setHcpCOverA: (ratio) => {
      if (store.state.structure !== 'hcp') return false;
      setHcpCOverA(ratio);
      return true;
    },
    setCellRepeat: (repeat) => setCellRepeat(repeat),
    getAtomRenderInfo: () => {
      const state = store.state;
      const render = computeAtomRenderState(
        currentModel.atoms,
        state.displayMode,
        state.displayRange,
        state.atomHidden,
        state.ghostAtoms,
      );
      let rendered = 0;
      for (const value of render.rendered) if (value) rendered++;
      return {
        solid: render.solidCount,
        xray: render.xrayCount,
        rendered,
        hidden: currentModel.atoms.length - rendered,
      };
    },
    isAtomRendered: (index) => atomLayer.isRenderedIndex(index),
    getCamera: () => viewer.getCameraSnapshot(),
    setAutoRotate: (enabled) => store.set({ autoRotate: enabled }),
    setEditMode: (enabled) => store.set({ editMode: enabled }),
    showInterstitials: (show) => {
      if (show) {
        enterSiteMode();
      } else {
        store.set({
          showO: false,
          showT: false,
          ghostAtoms: false,
          selectedSiteId: null,
          focusedSiteId: null,
          siteFilter: store.state.siteFilter === 'selected' ? 'all' : store.state.siteFilter,
        });
      }
    },
    getCounts: () => {
      const counts = siteLayer.getVisibleCounts();
      return {
        ...counts,
        theoryO: currentModel.meta.octahedralPerConventionalCell,
        theoryT: currentModel.meta.tetrahedralPerConventionalCell,
      };
    },
    focusSite: (id) => {
      if (!currentModel.sites.some((site) => site.id === id)) return false;
      focusSite(id);
      return true;
    },
    resetView,
    getAtomScreenPosition: (index) => {
      const atom = currentModel.atoms[index];
      if (!atom) return null;
      return screenPosition(atom.position);
    },
    getSiteScreenPosition: (id) => {
      const site = currentModel.sites.find((candidate) => candidate.id === id);
      if (!site) return null;
      return screenPosition(site.position);
    },
    getLabelCount: () => labels.count,
    getCellInfo: () => cellLayer.getInfo(),
    getCellAnchorInfo: () => {
      const visibility = computeAtomVisibility(
        currentModel.atoms,
        store.state.displayMode,
        store.state.displayRange,
      );
      const anchor = cellLayer.getAnchorPosition();
      const anchorAtom = currentModel.atoms.find(
        (atom) =>
          Math.abs(atom.position.x - anchor[0]) < 1e-6 &&
          Math.abs(atom.position.y - anchor[1]) < 1e-6 &&
          Math.abs(atom.position.z - anchor[2]) < 1e-6,
      );
      const center = visibility.shell.centerAtom?.position ?? null;
      return {
        anchor,
        anchorAtomIndex: anchorAtom ? anchorAtom.index : -1,
        anchorKind: anchorAtom ? anchorAtom.kind : null,
        anchorLayer: anchorAtom ? anchorAtom.layer : null,
        centerIndex: visibility.shell.centerIndex,
        centerPosition: center ? [center.x, center.y, center.z] : null,
        matchesShellCenter: center
          ? Math.hypot(anchor[0] - center.x, anchor[1] - center.y, anchor[2] - center.z) <
            1e-6
          : false,
      };
    },
    getShellVisualInfo: () => shellLayer.getInfo(),
    getShellRingInfo: () => atomLayer.getShellRingInfo(),
    getVisibleAtomStats: () => {
      const state = store.state;
      const visibility = computeAtomVisibility(
        currentModel.atoms,
        state.displayMode,
        state.displayRange,
      );
      const render = computeAtomRenderState(
        currentModel.atoms,
        state.displayMode,
        state.displayRange,
        state.atomHidden,
        state.ghostAtoms,
      );
      const layers: Record<string, number> = {};
      const shells: Record<string, number> = {};
      for (const index of visibility.indices) {
        if (!render.solid[index]) continue;
        const atom = currentModel.atoms[index];
        layers[String(atom.layer)] = (layers[String(atom.layer)] ?? 0) + 1;
        const distance = Math.hypot(
          atom.position.x - (visibility.shell.centerAtom?.position.x ?? 0),
          atom.position.y - (visibility.shell.centerAtom?.position.y ?? 0),
          atom.position.z - (visibility.shell.centerAtom?.position.z ?? 0),
        );
        const key = distance.toFixed(3);
        shells[key] = (shells[key] ?? 0) + 1;
      }
      const center = visibility.shell.centerAtom;
      return {
        count: render.solidCount,
        xrayCount: render.xrayCount,
        layers,
        shells,
        centerIndex: visibility.shell.centerIndex,
        centerPosition: center ? [center.position.x, center.position.y, center.position.z] : null,
        centerDistance: center
          ? Math.hypot(center.position.x, center.position.y, center.position.z)
          : 0,
      };
    },
    getGhostInfo: () => atomLayer.getGhostInfo(),
    getSelectionInfo: () => atomLayer.getSelectionInfo(),
    getSiteMaterialInfo: () => siteLayer.getSiteMaterialInfo(),
    getModelScreenBounds: () => screenBounds(),
    getVisibleAtomScreenExtents: () => visibleAtomScreenExtents(),
    getAtomScreenDiameter: (index) => atomScreenDiameter(index),
    isAtomVisible: (index) => atomLayer.isVisibleIndex(index),
    getDisplayInfo: () => {
      const state = store.state;
      const visibility = computeAtomVisibility(
        currentModel.atoms,
        state.displayMode,
        state.displayRange,
      );
      const render = computeAtomRenderState(
        currentModel.atoms,
        state.displayMode,
        state.displayRange,
        state.atomHidden,
        state.ghostAtoms,
      );
      const counts = siteLayer.getVisibleCounts();
      const hidden: number[] = [];
      const xray: number[] = [];
      for (let i = 0; i < render.rendered.length; i++) {
        if (!render.rendered[i]) hidden.push(i);
        else if (render.xray[i]) xray.push(i);
      }
      const atomInfo = atomLayer.getDisplayInfo();
      return {
        displayRadius: state.atomDisplayRadius,
        visibleAtomCount: render.solidCount,
        totalAtomCount: currentModel.atoms.length,
        hiddenAtomIndices: hidden,
        xrayAtomIndices: xray,
        visibleSiteCount: counts.O + counts.T,
        completeVisibleSiteCount: counts.completeO + counts.completeT,
        shellSize: visibility.shell.coordination + (visibility.shell.centerIndex >= 0 ? 1 : 0),
        shellCoordination: visibility.shell.coordination,
        shellCenterIndex: visibility.shell.centerIndex,
        fitRadius: currentViewRadius(state),
        cellBoundsRadius: cellLayer.getBoundsRadius(),
        cellCornerBoundsRadius: cellLayer.getCornerBoundsRadius(),
        ringScale: atomInfo.ringScale,
      };
    },
    setDisplay: (options) => {
      const patch: Partial<AppState> = {};
      if (options.radius !== undefined) patch.atomDisplayRadius = clampDisplayRadius(options.radius);
      if (options.range !== undefined) patch.displayRange = clampDisplayRange(options.range);
      if (options.mode !== undefined) patch.displayMode = options.mode;
      if (options.followSites !== undefined) patch.followRangeForSites = options.followSites;
      store.set(patch);
    },
    resetDisplay,
    fitView,
    getSiteVisibilityInfo: () => {
      const state = store.state;
      const visibility = computeAtomVisibility(
        currentModel.atoms,
        state.displayMode,
        state.displayRange,
      );
      const visibleIds = visibleSiteIds(state);
      return currentModel.sites.map((site) => ({
        id: site.id,
        type: site.type,
        complete: site.complete,
        visible: visibleIds.has(site.id),
        allNeighborsVisible: siteNeighborsFullyVisible(site, visibility.visible),
        visibleCoordination: siteVisibleCoordination(site, visibility.visible),
      }));
    },
    getSelectionPolyhedronInfo: () => siteLayer.getSelectionInfo(),
    getScaleReference: () => scaleReference(),
    getVisibleSiteCount: () => {
      const counts = siteLayer.getVisibleCounts();
      return counts.O + counts.T;
    },
    getRendererInfo: () => viewer.getRendererInfo(),
    getExportState: () => {
      const last = dialog.getLastResult();
      return {
        running: dialog.isRunning(),
        hasResult: Boolean(last),
        last: last
          ? {
              format: last.format,
              width: last.width,
              height: last.height,
              frames: last.frames,
            }
          : null,
      };
    },
  };

  function screenPosition(local: { x: number; y: number; z: number }): {
    x: number;
    y: number;
    inView: boolean;
  } {
    const point = projectToScreen(local);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y, inView: point.inView };
  }

  function viewportPoint(world: Vector3): { x: number; y: number } {
    const point = world.clone().project(viewer.camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (point.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-point.y * 0.5 + 0.5) * rect.height,
    };
  }

  function screenBounds(): ScreenBounds | null {
    const rect = canvas.getBoundingClientRect();
    const state = store.state;
    if (rect.width < 2 || rect.height < 2 || currentModel.atoms.length === 0 || !state.showAtoms) {
      return null;
    }
    const render = computeAtomRenderState(
      currentModel.atoms,
      state.displayMode,
      state.displayRange,
      state.atomHidden,
      state.ghostAtoms,
    );
    viewer.root.updateMatrixWorld(true);
    const right = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 1);
    let left = Infinity;
    let top = Infinity;
    let rightEdge = -Infinity;
    let bottom = -Infinity;
    for (let index = 0; index < currentModel.atoms.length; index++) {
      if (!render.solid[index]) continue;
      const atom = currentModel.atoms[index];
      const radius = state.atomDisplayRadius * resolveAtomSize(state, atom.id);
      const centre = viewer.root.localToWorld(
        new Vector3(atom.position.x, atom.position.y, atom.position.z),
      );
      for (const offset of [right, up, right.clone().negate(), up.clone().negate()]) {
        const point = viewportPoint(centre.clone().addScaledVector(offset, radius));
        left = Math.min(left, point.x);
        top = Math.min(top, point.y);
        rightEdge = Math.max(rightEdge, point.x);
        bottom = Math.max(bottom, point.y);
      }
    }
    return {
      left,
      top,
      right: rightEdge,
      bottom,
      width: rightEdge - left,
      height: bottom - top,
    };
  }

  function visibleAtomScreenExtents(): Array<{
    index: number;
    x: number;
    y: number;
    radius: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
  }> {
    const rect = canvas.getBoundingClientRect();
    const state = store.state;
    if (!state.showAtoms || rect.width < 2 || rect.height < 2) return [];
    const render = computeAtomRenderState(
      currentModel.atoms,
      state.displayMode,
      state.displayRange,
      state.atomHidden,
      state.ghostAtoms,
    );
    viewer.root.updateMatrixWorld(true);
    const right = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 1);
    const offsets = [right, up, right.clone().negate(), up.clone().negate()];
    const out: Array<{
      index: number;
      x: number;
      y: number;
      radius: number;
      left: number;
      right: number;
      top: number;
      bottom: number;
    }> = [];
    for (let index = 0; index < currentModel.atoms.length; index++) {
      if (!render.solid[index]) continue;
      const atom = currentModel.atoms[index];
      const radius = atomLayer.getDisplaySize(index);
      const centre = viewer.root.localToWorld(
        new Vector3(atom.position.x, atom.position.y, atom.position.z),
      );
      const point = viewportPoint(centre);
      let extent = 0;
      for (const offset of offsets) {
        const edge = viewportPoint(centre.clone().addScaledVector(offset, radius));
        extent = Math.max(extent, Math.hypot(edge.x - point.x, edge.y - point.y));
      }
      out.push({
        index,
        x: point.x,
        y: point.y,
        radius: extent,
        left: point.x - extent,
        right: point.x + extent,
        top: point.y - extent,
        bottom: point.y + extent,
      });
    }
    return out;
  }

  function atomScreenDiameter(index: number): number | null {
    const atom = currentModel.atoms[index];
    if (!atom || !atomLayer.isRenderedIndex(index)) return null;
    viewer.root.updateMatrixWorld(true);
    const centre = viewer.root.localToWorld(
      new Vector3(atom.position.x, atom.position.y, atom.position.z),
    );
    const right = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 0);
    const radius = atomLayer.getDisplaySize(index);
    const a = viewportPoint(centre.clone().addScaledVector(right, radius));
    const b = viewportPoint(centre.clone().addScaledVector(right, -radius));
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function scaleReference(): number {
    viewer.root.updateMatrixWorld(true);
    const right = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 0);
    const origin = viewer.root.localToWorld(new Vector3(0, 0, 0));
    const a = viewportPoint(origin.clone().addScaledVector(right, 1));
    const b = viewportPoint(origin.clone().addScaledVector(right, -1));
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  window.__CRYSTAL_READY__ = false;
  window.__CRYSTAL_DEBUG__ = debug;

  rebuildScene(0);
  sync(store.state);
  viewer.start(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.__CRYSTAL_READY__ = true;
        hud.markReady();
      });
    });
  });
}
