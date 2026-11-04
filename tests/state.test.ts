import { describe, expect, it } from 'vitest';
import {
  HCP_C_OVER_A,
  HCP_MAX_C_OVER_A,
  HCP_MIN_C_OVER_A,
  buildCrystal,
} from '../src/crystal/structures';
import {
  MAX_ATOM_SIZE,
  MIN_ATOM_SIZE,
  atomEditCount,
  clampAtomSize,
  createDefaultState,
  isAtomHidden,
  resolveAtomColor,
  resolveAtomSize,
  resolveCellStyle,
  resolveHcpCOverA,
  selectedAtom,
  selectedAtoms,
} from '../src/state';
import type { AppState } from '../src/state';

/**
 * The 2026-11 revision moved display defaults to 0.50r / 100 % / 85 % manual and
 * added per-atom colour/size/hidden overrides plus the HCP c/a sandbox. These
 * helpers are pure state resolution, so they can be pinned without a browser.
 */
const fcc = buildCrystal('fcc');
const hcp = buildCrystal('hcp');

function withState(patch: Partial<AppState>): AppState {
  return { ...createDefaultState(), ...patch };
}

describe('app state defaults (2026-11)', () => {
  it('ships the new display defaults', () => {
    const state = createDefaultState();
    expect(state.atomDisplayRadius).toBe(0.5);
    expect(state.displayRange).toBe(1);
    expect(state.displayMode).toBe('range');
    expect(state.followRangeForSites).toBe(true);
    expect(state.cellLineWidth).toBe(2.8);
    expect(state.cellLineBrightness).toBe(0.85);
    expect(state.cellStyleAuto).toBe(false);
    expect(state.autoRotateSpeed).toBe(0.6);
    expect(state.colorInner).toBe('#B87333');
    expect(state.colorOuter).toBe('#F6C453');
    expect(state.colorMode).toBe('radial');
    expect(state.allAtomColor).toBeNull();
    expect(state.editMode).toBe(true);
    expect(state.selectedAtomIds).toEqual([]);
    expect(state.atomHidden).toEqual({});
    expect(state.atomSizes).toEqual({});
    expect(state.hcpCOverA).toBeCloseTo(HCP_C_OVER_A, 12);
  });

  it('keeps explicit per-atom overrides as the only persistent edits', () => {
    expect(atomEditCount(createDefaultState())).toBe(0);
    const state = withState({
      atomColors: { 'fcc:corner:x': '#FF0000' },
      atomHidden: { 'fcc:face:y': true },
      atomSizes: { 'fcc:body:z': 1.2 },
    });
    expect(atomEditCount(state)).toBe(3);
    expect(isAtomHidden(state, 'fcc:face:y')).toBe(true);
    expect(isAtomHidden(state, 'fcc:corner:x')).toBe(false);
  });
});

describe('resolveAtomColor', () => {
  it('uses the bronze/gold radial split by default', () => {
    const state = createDefaultState();
    const inner = fcc.atoms.find((atom) => atom.radial <= 0.6);
    const outer = fcc.atoms.find((atom) => atom.radial > 0.6);
    expect(inner).toBeDefined();
    expect(outer).toBeDefined();
    if (!inner || !outer) return;
    expect(resolveAtomColor(inner, fcc.meta, state)).toBe('#B87333');
    expect(resolveAtomColor(outer, fcc.meta, state)).toBe('#F6C453');
  });

  it('lets a uniform colour override the mode but not per-atom colours', () => {
    const atom = fcc.atoms[0];
    const uniform = withState({ allAtomColor: '#112233' });
    expect(resolveAtomColor(atom, fcc.meta, uniform)).toBe('#112233');

    const both = withState({
      allAtomColor: '#112233',
      atomColors: { [atom.id]: '#E06A3A' },
    });
    expect(resolveAtomColor(atom, fcc.meta, both)).toBe('#E06A3A');
  });

  it('supports gold and HCP stacking modes', () => {
    const atom = fcc.atoms[0];
    expect(resolveAtomColor(atom, fcc.meta, withState({ colorMode: 'gold' }))).toBe('#F6C453');

    const stacking = withState({ colorMode: 'stacking' });
    const typeA = hcp.atoms.find((candidate) => candidate.kind === 'A');
    const typeB = hcp.atoms.find((candidate) => candidate.kind === 'B');
    expect(typeA).toBeDefined();
    expect(typeB).toBeDefined();
    if (!typeA || !typeB) return;
    expect(resolveAtomColor(typeA, hcp.meta, stacking)).toBe('#B87333');
    expect(resolveAtomColor(typeB, hcp.meta, stacking)).toBe('#F6C453');
  });
});

describe('resolveAtomSize / clampAtomSize', () => {
  it('clamps to the supported 40 %–160 % interval', () => {
    expect(clampAtomSize(0.1)).toBe(MIN_ATOM_SIZE);
    expect(clampAtomSize(9)).toBe(MAX_ATOM_SIZE);
    expect(clampAtomSize(Number.NaN)).toBe(1);
    expect(clampAtomSize(1.25)).toBe(1.25);
  });

  it('defaults to 1 and reads the per-atom multiplier', () => {
    const atom = fcc.atoms[0];
    const state = createDefaultState();
    expect(resolveAtomSize(state, atom.id)).toBe(1);
    const sized = withState({ atomSizes: { [atom.id]: 1.4 } });
    expect(resolveAtomSize(sized, atom.id)).toBe(1.4);
    const clamped = withState({ atomSizes: { [atom.id]: 9 } });
    expect(resolveAtomSize(clamped, atom.id)).toBe(MAX_ATOM_SIZE);
    const nan = withState({ atomSizes: { [atom.id]: Number.NaN } });
    expect(resolveAtomSize(nan, atom.id)).toBe(1);
  });
});

describe('resolveCellStyle', () => {
  it('keeps the manual 2.8 px / 85 % default', () => {
    expect(resolveCellStyle(createDefaultState())).toEqual({
      width: 2.8,
      brightness: 0.85,
      auto: false,
    });
  });

  it('interpolates from 2.8 px / 85 % to 3.0 px / 95 % in auto mode', () => {
    const atHalf = resolveCellStyle(withState({ cellStyleAuto: true }));
    expect(atHalf).toEqual({ width: 2.8, brightness: 0.85, auto: true });

    const atFull = resolveCellStyle(withState({ cellStyleAuto: true, atomDisplayRadius: 1 }));
    expect(atFull.width).toBeCloseTo(3, 12);
    expect(atFull.brightness).toBeCloseTo(0.95, 12);
    expect(atFull.auto).toBe(true);
  });
});

describe('HCP c/a sandbox state', () => {
  it('clamps the state ratio to the hard-sphere interval', () => {
    expect(resolveHcpCOverA(withState({ hcpCOverA: 1 }))).toBeCloseTo(HCP_MIN_C_OVER_A, 12);
    expect(resolveHcpCOverA(withState({ hcpCOverA: 2.4 }))).toBeCloseTo(HCP_MAX_C_OVER_A, 12);
    expect(resolveHcpCOverA(withState({ hcpCOverA: 1.8 }))).toBeCloseTo(1.8, 12);
    expect(resolveHcpCOverA(withState({ hcpCOverA: Number.NaN }))).toBeCloseTo(HCP_C_OVER_A, 12);
  });
});

describe('selection helpers', () => {
  it('keeps primary selection first and ignores unknown ids', () => {
    const [first, second] = fcc.atoms;
    const state = withState({ selectedAtomIds: [second.id, first.id, 'missing'] });
    expect(selectedAtom(state, fcc.atoms)?.id).toBe(second.id);
    // selectedAtoms keeps the model order, not the click order.
    expect(selectedAtoms(state, fcc.atoms).map((atom) => atom.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(selectedAtom(withState({ selectedAtomIds: [] }), fcc.atoms)).toBeNull();
    expect(selectedAtoms(withState({ selectedAtomIds: [] }), fcc.atoms)).toEqual([]);
  });
});
