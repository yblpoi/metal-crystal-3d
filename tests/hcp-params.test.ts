import { describe, expect, it } from 'vitest';
import {
  HCP_A,
  HCP_C_OVER_A,
  HCP_MAX_C_OVER_A,
  HCP_MIN_C_OVER_A,
  buildCrystal,
  clampHcpCOverA,
  hcpLattice,
} from '../src/crystal/structures';
import { minPairDistance, validateCrystal } from '../src/crystal/neighbors';

/**
 * The HCP parameter sandbox keeps the hard-sphere invariants (r = 1 and no
 * overlap) while c/a is stretched above the ideal ratio. Lowering c/a below
 * sqrt(8/3) would push interlayer neighbours closer than 2r, so it is clamped.
 */
describe('HCP c/a parameter sandbox', () => {
  it('clamps c/a to the scientifically valid hard-sphere interval', () => {
    expect(HCP_MIN_C_OVER_A).toBeCloseTo(Math.sqrt(8 / 3), 12);
    expect(HCP_MAX_C_OVER_A).toBe(1.9);
    expect(clampHcpCOverA(1.2)).toBeCloseTo(HCP_MIN_C_OVER_A, 12);
    expect(clampHcpCOverA(2.4)).toBe(1.9);
    expect(clampHcpCOverA(Number.NaN)).toBeCloseTo(HCP_C_OVER_A, 12);
  });

  it('keeps r = 1, a = 2 and the ideal model at the default c/a', () => {
    const ideal = buildCrystal('hcp');
    expect(ideal.meta.lattice.cOverA).toBeCloseTo(HCP_C_OVER_A, 9);
    expect(ideal.meta.lattice.a).toBeCloseTo(HCP_A, 12);
    expect(ideal.atoms).toHaveLength(57);
    expect(minPairDistance(ideal.atoms)).toBeCloseTo(2, 9);
    expect(ideal.meta.apf).toBeCloseTo(0.74048, 5);
    expect(ideal.meta.radiusRatioOctahedral).toBeCloseTo(Math.SQRT2 - 1, 9);
    expect(ideal.meta.radiusRatioTetrahedral).toBeCloseTo(Math.sqrt(3 / 2) - 1, 9);
  });

  it('recomputes lattice, APF, radius ratios and site distances at c/a = 1.8', () => {
    const model = buildCrystal('hcp', { hcpCOverA: 1.8 });
    const { a, c, cOverA } = model.meta.lattice;
    expect(a).toBeCloseTo(2, 12);
    expect(c).toBeCloseTo(3.6, 12);
    expect(cOverA).toBeCloseTo(1.8, 12);

    // 2 atoms in a primitive cell of V = a^2 * c * sin(60).
    const expectedApf = (2 * (4 / 3) * Math.PI) / (4 * 3.6 * Math.sin(Math.PI / 3));
    expect(model.meta.apf).toBeCloseTo(expectedApf, 12);

    const oDistance = Math.sqrt(4 / 3 + (3.6 * 3.6) / 16);
    const tVertical = (3 * 3.6) / 8;
    const tSlanted = Math.sqrt(4 / 3 + (3.6 * 3.6) / 64);
    expect(model.meta.radiusRatioOctahedral).toBeCloseTo(oDistance - 1, 12);
    expect(model.meta.radiusRatioTetrahedral).toBeCloseTo(
      Math.min(tVertical, tSlanted) - 1,
      12,
    );

    // Same topology, new geometry: a complete O site still has 6 neighbours.
    const o = model.sites.find((site) => site.type === 'O' && site.complete);
    expect(o).toBeDefined();
    if (!o) return;
    expect(o.coordination).toBe(6);
    expect(o.neighborDistances).toHaveLength(6);
    for (const d of o.neighborDistances) expect(d).toBeCloseTo(oDistance, 9);
    expect(o.maxRadius).toBeCloseTo(oDistance - 1, 9);

    const t = model.sites.find((site) => site.type === 'T' && site.complete);
    expect(t).toBeDefined();
    if (!t) return;
    expect(t.coordination).toBe(4);
    // A tetrahedral site keeps 4 neighbours: one along the c axis at 3c/8 and
    // three in the adjacent layer at sqrt(a^2/3 + c^2/64). Stretching c splits
    // what is a single distance at the ideal ratio into 1 + 3.
    expect(tSlanted).toBeLessThan(tVertical);
    for (const d of t.neighborDistances.slice(0, 3)) {
      expect(d).toBeCloseTo(tSlanted, 9);
    }
    expect(t.neighborDistances[3]).toBeCloseTo(tVertical, 9);

    expect(minPairDistance(model.atoms)).toBeGreaterThanOrEqual(2 - 1e-6);
    expect(validateCrystal(model).ok).toBe(true);
  });

  it('keeps coordination topology and no overlap across the whole interval', () => {
    for (const ratio of [HCP_MIN_C_OVER_A, 1.7, 1.8, HCP_MAX_C_OVER_A]) {
      const model = buildCrystal('hcp', { hcpCOverA: ratio });
      expect(model.atoms, String(ratio)).toHaveLength(57);
      expect(model.sites, String(ratio)).toHaveLength(86);
      expect(minPairDistance(model.atoms), String(ratio)).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(validateCrystal(model).ok, String(ratio)).toBe(true);
      const completeO = model.sites.filter((site) => site.type === 'O' && site.complete);
      const completeT = model.sites.filter((site) => site.type === 'T' && site.complete);
      expect(completeO.length, String(ratio)).toBeGreaterThan(0);
      expect(completeT.length, String(ratio)).toBeGreaterThan(0);
      for (const site of completeO) expect(site.coordination, String(ratio)).toBe(6);
      for (const site of completeT) expect(site.coordination, String(ratio)).toBe(4);
    }
  });

  it('reports the interlayer gap that a stretched c opens between layers', () => {
    for (const ratio of [1.7, 1.9]) {
      const lattice = hcpLattice(ratio);
      const interlayer = Math.sqrt(
        (lattice.a * lattice.a) / 3 + (lattice.c * lattice.c) / 4,
      );
      expect(interlayer).toBeGreaterThanOrEqual(2 - 1e-9);
    }
  });
});
