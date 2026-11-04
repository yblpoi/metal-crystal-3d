import type { Atom, StructureId, StructureMeta } from './crystal/types';
import type { DisplayMode } from './crystal/visibility';

/**
 * Single source of truth for the UI and the scene. Everything that can be
 * changed from the interface lives here; the scene never owns UI state.
 */

export type ColorMode = 'radial' | 'stacking' | 'gold';
export type SiteFilter = 'all' | 'complete' | 'selected';
export type BackgroundPreset = 'deep' | 'aurora' | 'gold' | 'custom';

export interface AppState {
  structure: StructureId;
  colorMode: ColorMode;
  colorInner: string;
  colorOuter: string;
  autoRotate: boolean;
  autoRotateSpeed: number;
  showCell: boolean;
  cellXray: boolean;
  cellLineWidth: number;
  cellLineBrightness: number;
  /** Cell stroke width/brightness follow the display radius until the user overrides. */
  cellStyleAuto: boolean;
  ghostAtoms: boolean;
  showAtoms: boolean;
  /** Display-only atom radius in units of the underlying r = 1 sphere. */
  atomDisplayRadius: number;
  /** Display-only radial cut, normalised by the cluster's maximum radial. */
  displayRange: number;
  displayMode: DisplayMode;
  /** Hide interstitial sites whose first shell is outside the visible atoms. */
  followRangeForSites: boolean;
  showO: boolean;
  showT: boolean;
  siteScale: number;
  siteOpacity: number;
  siteBrowserType: 'O' | 'T';
  showPolyhedron: boolean;
  showSiteLabels: boolean;
  showBonds: boolean;
  siteFilter: SiteFilter;
  editMode: boolean;
  background: BackgroundPreset;
  customBg: string;
  selectedAtomId: string | null;
  selectedSiteId: string | null;
  focusedSiteId: string | null;
  atomColors: Record<string, string>;
}

const STORAGE_KEY = 'crystal-atlas:atom-colors:v1';
export const RADIAL_SPLIT = 0.6;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

export function normalizeHex(value: string): string {
  return value.toUpperCase();
}

function loadAtomColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && isHexColor(value)) out[key] = normalizeHex(value);
    }
    return out;
  } catch {
    return {};
  }
}

function persistAtomColors(colors: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    /* Storage can be unavailable (private mode); colour edits still work in-session. */
  }
}

export function createDefaultState(): AppState {
  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    structure: 'fcc',
    colorMode: 'radial',
    colorInner: '#B07A1E',
    colorOuter: '#F6C453',
    autoRotate: !reduceMotion,
    autoRotateSpeed: 1.2,
    showCell: true,
    cellXray: false,
    cellLineWidth: 2.8,
    cellLineBrightness: 0.82,
    cellStyleAuto: true,
    ghostAtoms: false,
    showAtoms: true,
    atomDisplayRadius: 0.68,
    displayRange: 0.62,
    displayMode: 'range',
    followRangeForSites: true,
    showO: false,
    showT: false,
    siteScale: 0.7,
    siteOpacity: 0.6,
    siteBrowserType: 'O',
    showPolyhedron: true,
    showSiteLabels: false,
    showBonds: false,
    siteFilter: 'all',
    editMode: false,
    background: 'deep',
    customBg: '#0A2B4D',
    selectedAtomId: null,
    selectedSiteId: null,
    focusedSiteId: null,
    atomColors: loadAtomColors(),
  };
}

type Listener = (state: Readonly<AppState>, patch: Partial<AppState>) => void;

export class AppStore {
  private current: AppState;
  private listeners = new Set<Listener>();

  constructor() {
    this.current = createDefaultState();
  }

  get state(): Readonly<AppState> {
    return this.current;
  }

  set(patch: Partial<AppState>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof AppState)[]) {
      const next = patch[key];
      if (next !== undefined && next !== this.current[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    const nextState = { ...this.current, ...patch };
    this.current = nextState;
    if (patch.atomColors) persistAtomColors(nextState.atomColors);
    for (const listener of this.listeners) listener(nextState, patch);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Resolved cell stroke: the auto track tightens the frame as atoms shrink. */
export function resolveCellStyle(state: Readonly<AppState>): {
  width: number;
  brightness: number;
  auto: boolean;
} {
  if (!state.cellStyleAuto) {
    return { width: state.cellLineWidth, brightness: state.cellLineBrightness, auto: false };
  }
  const t = Math.min(1, Math.max(0, (state.atomDisplayRadius - 0.68) / 0.32));
  return {
    width: 2.8 + 0.2 * t,
    brightness: 0.82 + 0.08 * t,
    auto: true,
  };
}

/** Per-atom colour, with explicit overrides winning over the global mode. */
export function resolveAtomColor(atom: Atom, meta: StructureMeta, state: Readonly<AppState>): string {
  const override = state.atomColors[atom.id];
  if (override) return override;

  switch (state.colorMode) {
    case 'gold':
      return state.colorOuter;
    case 'radial':
      return atom.radial <= RADIAL_SPLIT ? state.colorInner : state.colorOuter;
    case 'stacking': {
      if (meta.id === 'hcp') return atom.kind === 'A' ? state.colorInner : state.colorOuter;
      const planes = Math.round((atom.position.z + meta.lattice.a) / (meta.lattice.a / 2));
      return planes % 2 === 0 ? state.colorInner : state.colorOuter;
    }
    default: {
      const never: never = state.colorMode;
      return never;
    }
  }
}

export function selectedAtom(state: Readonly<AppState>, atoms: Atom[]): Atom | null {
  if (!state.selectedAtomId) return null;
  return atoms.find((atom) => atom.id === state.selectedAtomId) ?? null;
}
