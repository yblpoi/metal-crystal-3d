import { Vector2, Vector3 } from 'three';
import { buildCrystal } from './crystal/structures';
import type { Atom, CrystalModel, InterstitialSite, StructureId } from './crystal/types';
import {
  clampDisplayRadius,
  clampDisplayRange,
  computeAtomVisibility,
  isSiteVisibleInDisplay,
  siteNeighborsFullyVisible,
  siteVisibleCoordination,
  visibleSitesInDisplay,
  type DisplayMode,
} from './crystal/visibility';
import { resolveBackground } from './background';
import { filterSites } from './site-filter';
import {
  isHexColor,
  normalizeHex,
  resolveAtomColor,
  resolveCellStyle,
  selectedAtom as pickSelectedAtom,
  type AppState,
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
  colorMode: AppState['colorMode'];
  selectedAtomId: string | null;
  selectedSiteId: string | null;
  focusedSiteId: string | null;
  editMode: boolean;
  autoRotate: boolean;
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
    centerIndex: number;
    centerPosition: [number, number, number] | null;
    matchesShellCenter: boolean;
  };
  getShellVisualInfo: () => ReturnType<CoordinationShellLayer['getInfo']>;
  getShellRingInfo: () => { visible: boolean; index: number | null; scale: number };
  getVisibleAtomStats: () => {
    count: number;
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
  const models = new Map<StructureId, CrystalModel>();
  for (const id of STRUCTURE_IDS) models.set(id, buildCrystal(id));
  const hcpModel = models.get('hcp');
  if (!hcpModel) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hud = new Hud((id) => switchStructure(id));
  const canvas = must<HTMLCanvasElement>('crystal-canvas');
  // Frame the cell wireframe, not the full 57-atom HCP bounding sphere: the
  // default view is a 19-atom shrunken cluster inside a cell, and the old
  // HCP-radius framing left ~18% of the stage empty. The same radius is used
  // for every structure so the atom scale stays comparable.
  const defaultFrameRadius = Math.max(
    ...STRUCTURE_IDS.map((id) => cellWireRadius(models.get(id) ?? hcpModel)),
  );
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

  let currentModel = models.get(store.state.structure) ?? hcpModel;
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
      viewer.resetView(450);
      return;
    }
    store.set({
      structure: id,
      selectedAtomId: null,
      selectedSiteId: null,
      focusedSiteId: null,
      siteFilter: state.siteFilter === 'selected' ? 'all' : state.siteFilter,
    });
    const meta = models.get(id)?.meta;
    if (meta) hud.showToast(`${meta.abbreviation} · ${meta.name} · CN ${meta.coordinationNumber}`);
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
      selectedAtomId: null,
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
      patch.selectedAtomId = null;
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

  function selectAtom(atom: Atom): void {
    const hadFocus = Boolean(store.state.focusedSiteId);
    store.set({
      editMode: true,
      selectedAtomId: atom.id,
      selectedSiteId: null,
      focusedSiteId: null,
    });
    if (hadFocus) viewer.focusTarget(null, 450);
  }

  function selectSite(site: InterstitialSite): void {
    const hadFocus = Boolean(store.state.focusedSiteId);
    store.set({
      selectedAtomId: null,
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
      selectedAtomId: null,
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
      selectedAtomId: null,
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
    viewer.resetView(450);
    hud.showToast('视角已重置 · 统一默认方向');
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
      atomDisplayRadius: 0.68,
      displayRange: 0.62,
      displayMode: 'range',
      followRangeForSites: true,
      cellStyleAuto: true,
    });
    hud.showToast('显示已重置 · 0.68r / 62% / 范围模式');
  }

  /**
   * Bounding radius of what is actually on screen now: visible atoms at the
   * display scale plus the cell wireframe (and visible site spheres). Used by
   * the explicit "适应视图" action and by export framing, never by sliders.
   */
  function currentViewRadius(state: Readonly<AppState>): number {
    let radius = 0;
    const visibility = computeAtomVisibility(currentModel.atoms, state.displayMode, state.displayRange);
    if (state.showAtoms) {
      for (const index of visibility.indices) {
        const atom = currentModel.atoms[index];
        radius = Math.max(
          radius,
          Math.hypot(atom.position.x, atom.position.y, atom.position.z) + state.atomDisplayRadius,
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
            visibility.visible,
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

  function setAtomColor(id: string, hex: string): boolean {
    if (!isHexColor(hex)) return false;
    if (!currentModel.atoms.some((atom) => atom.id === id)) return false;
    store.set({ atomColors: { ...store.state.atomColors, [id]: normalizeHex(hex) } });
    return true;
  }

  function restoreSelectedAtom(): void {
    const id = store.state.selectedAtomId;
    if (!id || !store.state.atomColors[id]) return;
    const next = { ...store.state.atomColors };
    delete next[id];
    store.set({ atomColors: next });
    hud.showToast('已恢复此球默认颜色');
  }

  function resetAllAtomColors(): void {
    if (Object.keys(store.state.atomColors).length === 0) return;
    store.set({ atomColors: {} });
    hud.showToast('已重置全部逐球颜色');
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
    setFollowSites,
    resetDisplay,
    setAtomColor,
    restoreSelectedAtom,
    resetAllAtomColors,
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
    const atom = pickSelectedAtom(state, currentModel.atoms);
    if (atom) {
      const anchor = projectToScreen(atom.position);
      if (anchor.inView) {
        specs.push({
          id: `atom:${atom.id}`,
          text: `M · ${atomKindLabel(atom.kind)}`,
          accent: '#F6C453',
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
    if (state.autoRotate && !state.selectedAtomId && !state.selectedSiteId) return false;
    return true;
  }

  function refreshLabels(state: Readonly<AppState>): void {
    labels.setLabels(buildLabels(state));
    labels.setVisible(labelsShouldShow(state));
  }

  function applyScene(state: Readonly<AppState>): void {
    const visibility = computeAtomVisibility(currentModel.atoms, state.displayMode, state.displayRange);
    atomLayer.setColors(
      currentModel.atoms.map((atom) => resolveAtomColor(atom, currentModel.meta, state)),
    );
    atomLayer.setDisplay(visibility.visible, state.atomDisplayRadius);
    atomLayer.setGhost(state.ghostAtoms);
    atomLayer.setVisible(state.showAtoms);
    const selectedIndex = state.selectedAtomId
      ? currentModel.atoms.findIndex((atom) => atom.id === state.selectedAtomId)
      : -1;
    atomLayer.setSelected(
      selectedIndex >= 0 && visibility.visible[selectedIndex] ? selectedIndex : null,
    );
    atomLayer.setShellCenter(
      state.displayMode === 'shell' ? visibility.shell.centerIndex : null,
    );

    const cellStyle = resolveCellStyle(state);
    cellLayer.setVisible(state.showCell);
    cellLayer.setDisplayRadius(state.atomDisplayRadius);
    cellLayer.setAtomVisibility(visibility.visible);
    cellLayer.setStyle(cellStyle.width, cellStyle.brightness);
    cellLayer.setXray(state.cellXray);

    shellLayer.update(
      currentModel,
      visibility.shell,
      state.displayMode === 'shell' && state.showPolyhedron,
    );

    siteLayer.update({
      showO: state.showO,
      showT: state.showT,
      filter: state.siteFilter,
      selectedSiteId: state.selectedSiteId,
      scale: state.siteScale,
      displayScale: state.atomDisplayRadius,
      opacity: state.siteOpacity,
      atomVisible: visibility.visible,
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
        state.selectedAtomId ||
          state.selectedSiteId ||
          state.focusedSiteId ||
          state.displayMode === 'shell',
      ),
    );

    const legendO = document.getElementById('legend-o-row');
    const legendT = document.getElementById('legend-t-row');
    if (legendO) legendO.hidden = !state.showO;
    if (legendT) legendT.hidden = !state.showT;

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

  function rebuildScene(duration: number): void {
    currentModel = models.get(store.state.structure) ?? currentModel;
    atomLayer.build(currentModel);
    cellLayer.build(currentModel);
    cellLayer.setResolution(canvas.clientWidth, canvas.clientHeight);
    siteLayer.build(currentModel);
    shellLayer.build(currentModel);
    shellLayer.setResolution(canvas.clientWidth, canvas.clientHeight);
    labels.clear();
    hud.hideTooltip();
    atomLayer.setHover(null);
    viewer.resetView(duration);
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
    if (
      patch.structure ||
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

    const visibility = computeAtomVisibility(currentModel.atoms, state.displayMode, state.displayRange);
    if (state.selectedAtomId) {
      const index = currentModel.atoms.findIndex((atom) => atom.id === state.selectedAtomId);
      if (index < 0 || !visibility.visible[index]) {
        store.set({ selectedAtomId: null });
        return;
      }
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

  // pointer helpers -------------------------------------------------
  function ndcFrom(clientX: number, clientY: number): Vector2 {
    const rect = canvas.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    return ndc;
  }

  function atomAt(clientX: number, clientY: number): Atom | null {
    if (!store.state.editMode || !store.state.showAtoms) return null;
    const mesh = atomLayer.instancedMesh;
    if (!mesh) return null;
    const hits = viewer.pick(ndcFrom(clientX, clientY), [mesh]);
    for (const hit of hits) {
      if (hit.instanceId === undefined) continue;
      if (!atomLayer.isVisibleIndex(hit.instanceId)) continue;
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
      canvas.classList.toggle('is-pointing', !state.editMode);
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
      const override = state.atomColors[atom.id];
      let avoid: DOMRect | null = null;
      if (state.selectedAtomId === atom.id) {
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
          meta: `${atomLayerLabel(atom, state.structure)}${override ? ' · 自定义颜色' : ''} · 点击选中`,
        },
        clientX,
        clientY,
        avoid,
      );
    } else {
      atomLayer.setHover(null);
      hud.hideTooltip();
      labels.setVisible(labelsShouldShow(state));
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
      selectAtom(atom);
      return;
    }
    if (store.state.selectedAtomId || store.state.selectedSiteId || store.state.focusedSiteId) {
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
  must<HTMLButtonElement>('reset-btn').addEventListener('click', resetView);
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
        colorMode: state.colorMode,
        selectedAtomId: state.selectedAtomId,
        selectedSiteId: state.selectedSiteId,
        focusedSiteId: state.focusedSiteId,
        editMode: state.editMode,
        autoRotate: state.autoRotate,
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
      const center = visibility.shell.centerAtom?.position ?? null;
      return {
        anchor,
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
      const visibility = computeAtomVisibility(
        currentModel.atoms,
        store.state.displayMode,
        store.state.displayRange,
      );
      const layers: Record<string, number> = {};
      const shells: Record<string, number> = {};
      for (const index of visibility.indices) {
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
        count: visibility.count,
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
      const counts = siteLayer.getVisibleCounts();
      const hidden: number[] = [];
      for (let i = 0; i < visibility.visible.length; i++) {
        if (!visibility.visible[i]) hidden.push(i);
      }
      const atomInfo = atomLayer.getDisplayInfo();
      return {
        displayRadius: state.atomDisplayRadius,
        visibleAtomCount: visibility.count,
        totalAtomCount: currentModel.atoms.length,
        hiddenAtomIndices: hidden,
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
    const visibility = computeAtomVisibility(currentModel.atoms, state.displayMode, state.displayRange);
    viewer.root.updateMatrixWorld(true);
    const right = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 1);
    let left = Infinity;
    let top = Infinity;
    let rightEdge = -Infinity;
    let bottom = -Infinity;
    for (const index of visibility.indices) {
      const atom = currentModel.atoms[index];
      const centre = viewer.root.localToWorld(
        new Vector3(atom.position.x, atom.position.y, atom.position.z),
      );
      for (const offset of [right, up, right.clone().negate(), up.clone().negate()]) {
        const point = viewportPoint(
          centre.clone().addScaledVector(offset, state.atomDisplayRadius),
        );
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
    const visibility = computeAtomVisibility(currentModel.atoms, state.displayMode, state.displayRange);
    viewer.root.updateMatrixWorld(true);
    const right = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 1);
    const radius = atomLayer.getDisplayRadius();
    const offsets = [right, up, right.clone().negate(), up.clone().negate()];
    return visibility.indices.map((index) => {
      const atom = currentModel.atoms[index];
      const centre = viewer.root.localToWorld(
        new Vector3(atom.position.x, atom.position.y, atom.position.z),
      );
      const point = viewportPoint(centre);
      let extent = 0;
      for (const offset of offsets) {
        const edge = viewportPoint(centre.clone().addScaledVector(offset, radius));
        extent = Math.max(extent, Math.hypot(edge.x - point.x, edge.y - point.y));
      }
      return {
        index,
        x: point.x,
        y: point.y,
        radius: extent,
        left: point.x - extent,
        right: point.x + extent,
        top: point.y - extent,
        bottom: point.y + extent,
      };
    });
  }

  function atomScreenDiameter(index: number): number | null {
    const atom = currentModel.atoms[index];
    if (!atom || !atomLayer.isVisibleIndex(index)) return null;
    viewer.root.updateMatrixWorld(true);
    const centre = viewer.root.localToWorld(
      new Vector3(atom.position.x, atom.position.y, atom.position.z),
    );
    const right = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 0);
    const radius = atomLayer.getDisplayRadius();
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
