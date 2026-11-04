import type { Atom, StructureId, StructureMeta } from './crystal/types';
import type { DisplayMode } from './crystal/visibility';
import { HCP_C_OVER_A, clampHcpCOverA } from './crystal/structures';

/**
 * Single source of truth for the UI and the scene. Everything that can be
 * changed from the interface lives here; the scene never owns UI state.
 */

export type ColorMode = 'radial' | 'stacking' | 'gold';
export type SiteFilter = 'all' | 'complete' | 'selected';
export type BackgroundPreset = 'deep' | 'aurora' | 'gold' | 'custom';

/** Per-atom display size multiplier applied on top of the global display radius. */
export const MIN_ATOM_SIZE = 0.4;
export const MAX_ATOM_SIZE = 1.6;

export interface AppState {
  structure: StructureId;
  colorMode: ColorMode;
  colorInner: string;
  colorOuter: string;
  /** Uniform colour override for every atom; null follows colorMode. */
  allAtomColor: string | null;
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
  /** Multi-select: every clicked atom id, primary selection first. */
  selectedAtomIds: string[];
  selectedSiteId: string | null;
  focusedSiteId: string | null;
  atomColors: Record<string, string>;
  /** Explicitly hidden atoms (display only; the crystallographic data is untouched). */
  atomHidden: Record<string, boolean>;
  /** Per-atom display size multiplier, clamped to [MIN_ATOM_SIZE, MAX_ATOM_SIZE]. */
  atomSizes: Record<string, number>;
  /** Scientific sandbox: HCP c/a ratio, clamped to the hard-sphere valid interval. */
  hcpCOverA: number;
}

const STORAGE_KEY = 'crystal-atlas:atom-colors:v1';
const STORAGE_KEY_HIDDEN = 'crystal-atlas:atom-hidden:v1';
const STORAGE_KEY_SIZES = 'crystal-atlas:atom-sizes:v1';
export const RADIAL_SPLIT = 0.6;
/** Default layer palette: gold shell around an ancient-bronze core. */
export const DEFAULT_COLOR_INNER = '#B87333';
export const DEFAULT_COLOR_OUTER = '#F6C453';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

export function normalizeHex(value: string): string {
  return value.toUpperCase();
}

export function clampAtomSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ATOM_SIZE, Math.max(MIN_ATOM_SIZE, value));
}

function readStorage(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be unavailable (private mode); edits still work in-session. */
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function loadAtomColors(): Record<string, string> {
  const parsed = readStorage(STORAGE_KEY);
  if (!isPlainObject(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isHexColor(value)) out[key] = normalizeHex(value);
  }
  return out;
}

function loadAtomHidden(): Record<string, boolean> {
  const parsed = readStorage(STORAGE_KEY_HIDDEN);
  if (!isPlainObject(parsed)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === true) out[key] = true;
  }
  return out;
}

function loadAtomSizes(): Record<string, number> {
  const parsed = readStorage(STORAGE_KEY_SIZES);
  if (!isPlainObject(parsed)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = clampAtomSize(value);
  }
  return out;
}

export function createDefaultState(): AppState {
  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    structure: 'fcc',
    colorMode: 'radial',
    // Ancient bronze core, gold shell: the default radial split is readable
    // even at the default 50 % display radius.
    colorInner: DEFAULT_COLOR_INNER,
    colorOuter: DEFAULT_COLOR_OUTER,
    allAtomColor: null,
    autoRotate: !reduceMotion,
    autoRotateSpeed: 0.6,
    showCell: true,
    cellXray: false,
    cellLineWidth: 2.8,
    cellLineBrightness: 0.85,
    cellStyleAuto: false,
    ghostAtoms: false,
    showAtoms: true,
    atomDisplayRadius: 0.5,
    displayRange: 1,
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
    editMode: true,
    background: 'deep',
    customBg: '#0A2B4D',
    selectedAtomIds: [],
    selectedSiteId: null,
    focusedSiteId: null,
    atomColors: loadAtomColors(),
    atomHidden: loadAtomHidden(),
    atomSizes: loadAtomSizes(),
    hcpCOverA: HCP_C_OVER_A,
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
    if (patch.atomColors) writeStorage(STORAGE_KEY, nextState.atomColors);
    if (patch.atomHidden) writeStorage(STORAGE_KEY_HIDDEN, nextState.atomHidden);
    if (patch.atomSizes) writeStorage(STORAGE_KEY_SIZES, nextState.atomSizes);
    this.current = nextState;
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
  const t = Math.min(1, Math.max(0, (state.atomDisplayRadius - 0.5) / 0.5));
  return {
    width: 2.8 + 0.2 * t,
    brightness: 0.85 + 0.1 * t,
    auto: true,
  };
}

/** Per-atom colour, with explicit overrides winning over the global mode. */
export function resolveAtomColor(atom: Atom, meta: StructureMeta, state: Readonly<AppState>): string {
  const override = state.atomColors[atom.id];
  if (override) return override;
  if (state.allAtomColor) return state.allAtomColor;

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

/** Display-only size multiplier for one atom (global display radius excluded). */
export function resolveAtomSize(state: Readonly<AppState>, atomId: string): number {
  return clampAtomSize(state.atomSizes[atomId] ?? 1);
}

export function isAtomHidden(state: Readonly<AppState>, atomId: string): boolean {
  return state.atomHidden[atomId] === true;
}

/** At most one hidden/size/colour override per atom; used by reset helpers. */
export function atomEditCount(state: Readonly<AppState>): number {
  return (
    Object.keys(state.atomColors).length +
    Object.keys(state.atomHidden).length +
    Object.keys(state.atomSizes).length
  );
}

export function selectedAtoms(state: Readonly<AppState>, atoms: Atom[]): Atom[] {
  if (state.selectedAtomIds.length === 0) return [];
  const wanted = new Set(state.selectedAtomIds);
  return atoms.filter((atom) => wanted.has(atom.id));
}

/** Primary selection (the atom whose label/tooltip is shown when exactly one). */
export function selectedAtom(state: Readonly<AppState>, atoms: Atom[]): Atom | null {
  const id = state.selectedAtomIds[0];
  if (!id) return null;
  return atoms.find((atom) => atom.id === id) ?? null;
}

/** Resolved HCP c/a used by the current model (clamped for safety). */
export function resolveHcpCOverA(state: Readonly<AppState>): number {
  return clampHcpCOverA(state.hcpCOverA);
}
