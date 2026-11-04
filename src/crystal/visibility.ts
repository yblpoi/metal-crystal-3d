import type { Atom, CrystalModel, InterstitialSite } from './types';
import { minPairDistance } from './neighbors';

/**
 * Display-only visibility model.
 *
 * Nothing here changes the crystallographic data: atoms keep radius 1, the
 * nearest-neighbour distance stays 2, and interstitial coordinates/radius
 * ratios are untouched. These helpers only decide which spheres are drawn and
 * at what display scale.
 */

export type DisplayMode = 'range' | 'shell' | 'all';

export const MIN_DISPLAY_RADIUS = 0.5;
export const MAX_DISPLAY_RADIUS = 1;
export const MIN_DISPLAY_RANGE = 0.4;
export const MAX_DISPLAY_RANGE = 1;

const DIST_TOL = 1e-6;

export interface CoordinationShell {
  /** Index of the central atom in CrystalModel.atoms, -1 for an empty cluster. */
  centerIndex: number;
  centerAtom: Atom | null;
  /** Indices of atoms at the nearest-neighbour distance from the centre. */
  neighborIndices: number[];
  coordination: number;
}

export interface AtomVisibility {
  /** Indexed exactly like CrystalModel.atoms, so colours never shift. */
  visible: boolean[];
  indices: number[];
  count: number;
  shell: CoordinationShell;
}

export function clampDisplayRadius(value: number): number {
  if (!Number.isFinite(value)) return MAX_DISPLAY_RADIUS;
  return Math.min(MAX_DISPLAY_RADIUS, Math.max(MIN_DISPLAY_RADIUS, value));
}

export function clampDisplayRange(value: number): number {
  if (!Number.isFinite(value)) return MAX_DISPLAY_RANGE;
  return Math.min(MAX_DISPLAY_RANGE, Math.max(MIN_DISPLAY_RANGE, value));
}

/**
 * First coordination shell of the finite teaching cluster.
 *
 * The centre is the atom with the most nearest neighbours, tie-broken by
 * distance to the cluster centre. This yields 13 atoms / CN 12 for FCC and
 * HCP, and 9 atoms / CN 8 for BCC. BCC is deliberately never padded to 12.
 */
export function firstCoordinationShell(atoms: Atom[]): CoordinationShell {
  if (atoms.length === 0) {
    return { centerIndex: -1, centerAtom: null, neighborIndices: [], coordination: 0 };
  }

  const nn = minPairDistance(atoms);
  let centerIndex = 0;
  let centerDistance = Infinity;
  let neighbors: number[] = [];

  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const found: number[] = [];
    for (let j = 0; j < atoms.length; j++) {
      if (i === j) continue;
      const b = atoms[j];
      const dx = a.position.x - b.position.x;
      const dy = a.position.y - b.position.y;
      const dz = a.position.z - b.position.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (Math.abs(d - nn) <= DIST_TOL) found.push(j);
    }

    const radial = Math.hypot(a.position.x, a.position.y, a.position.z);
    if (
      found.length > neighbors.length ||
      (found.length === neighbors.length && radial < centerDistance - DIST_TOL)
    ) {
      centerIndex = i;
      centerDistance = radial;
      neighbors = found;
    }
  }

  return {
    centerIndex,
    centerAtom: atoms[centerIndex],
    neighborIndices: neighbors,
    coordination: neighbors.length,
  };
}

/** Pure range / shell / all decision for every atom, indexed by atom array. */
export function computeAtomVisibility(
  atoms: Atom[],
  mode: DisplayMode,
  range: number,
): AtomVisibility {
  const shell = firstCoordinationShell(atoms);
  const visible = atoms.map(() => false);

  if (mode === 'all') {
    visible.fill(true);
  } else if (mode === 'shell') {
    if (shell.centerIndex >= 0) visible[shell.centerIndex] = true;
    for (const index of shell.neighborIndices) visible[index] = true;
  } else {
    const threshold = clampDisplayRange(range) + 1e-9;
    for (let i = 0; i < atoms.length; i++) {
      if (atoms[i].radial <= threshold) visible[i] = true;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < visible.length; i++) if (visible[i]) indices.push(i);

  return { visible, indices, count: indices.length, shell };
}

/**
 * Per-atom render state for the range/透视 model.
 *
 * `base` is the pure crystallographic range / shell / all decision and keeps
 * driving the interstitial follow rules. `solid` additionally removes atoms the
 * user hid and the global atom-xray toggle. In range mode, atoms outside the
 * cut are no longer deleted from the scene: they are drawn as atom-xray ghosts
 * (`xray`), which is what "调整显示范围后被隐藏的球体使用原子透视" means.
 */
export interface AtomRenderState {
  base: boolean[];
  solid: boolean[];
  xray: boolean[];
  rendered: boolean[];
  baseCount: number;
  solidCount: number;
  xrayCount: number;
}

export function computeAtomRenderState(
  atoms: Atom[],
  mode: DisplayMode,
  range: number,
  hidden: Readonly<Record<string, boolean>> = {},
  ghostAll = false,
): AtomRenderState {
  const visibility = computeAtomVisibility(atoms, mode, range);
  const base = visibility.visible;
  const solid = atoms.map(() => false);
  const xray = atoms.map(() => false);
  const rendered = atoms.map(() => false);
  let solidCount = 0;
  let xrayCount = 0;

  for (let i = 0; i < atoms.length; i++) {
    if (hidden[atoms[i].id]) continue;
    if (ghostAll) {
      // 原子透视: every atom that survives the range filter is a ghost, so no
      // solid sphere is drawn and nothing is double-rendered.
      if (base[i]) {
        xray[i] = true;
        rendered[i] = true;
        xrayCount++;
      }
      continue;
    }
    if (base[i]) {
      solid[i] = true;
      rendered[i] = true;
      solidCount++;
    } else if (mode === 'range') {
      xray[i] = true;
      rendered[i] = true;
      xrayCount++;
    }
  }

  return {
    base,
    solid,
    xray,
    rendered,
    baseCount: visibility.count,
    solidCount,
    xrayCount,
  };
}

/** Whether an interstitial position itself lies inside the active display range. */
export function isSiteInDisplayRange(
  site: InterstitialSite,
  model: CrystalModel,
  mode: DisplayMode,
  range: number,
): boolean {
  if (mode !== 'range') return true;
  const radius = Math.max(model.boundingRadius, 1e-9);
  const radial = Math.hypot(site.position.x, site.position.y, site.position.z) / radius;
  return radial <= clampDisplayRange(range) + 1e-9;
}

export function siteVisibleCoordination(site: InterstitialSite, atomVisible: boolean[]): number {
  let count = 0;
  for (const index of site.neighborIndices) {
    if (atomVisible[index]) count++;
  }
  return count;
}

export function siteNeighborsFullyVisible(
  site: InterstitialSite,
  atomVisible: boolean[],
): boolean {
  for (const index of site.neighborIndices) {
    if (!atomVisible[index]) return false;
  }
  return true;
}

/**
 * Follow-range rule for interstitial sites: the site is shown only when all of
 * its first-shell atoms are visible and its own position is inside the range.
 * With follow disabled, every site is shown even if its neighbours are hidden.
 */
export function isSiteVisibleInDisplay(
  site: InterstitialSite,
  model: CrystalModel,
  atomVisible: boolean[],
  mode: DisplayMode,
  range: number,
  followRange: boolean,
): boolean {
  if (!followRange) return true;
  if (!siteNeighborsFullyVisible(site, atomVisible)) return false;
  return isSiteInDisplayRange(site, model, mode, range);
}

export function visibleSitesInDisplay(
  model: CrystalModel,
  atomVisible: boolean[],
  mode: DisplayMode,
  range: number,
  followRange: boolean,
): InterstitialSite[] {
  if (!followRange) return model.sites;
  return model.sites.filter((site) =>
    isSiteVisibleInDisplay(site, model, atomVisible, mode, range, followRange),
  );
}
