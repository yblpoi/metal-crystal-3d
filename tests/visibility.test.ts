import { describe, expect, it } from 'vitest';
import { buildCrystal } from '../src/crystal/structures';
import { minPairDistance } from '../src/crystal/neighbors';
import {
  clampDisplayRadius,
  clampDisplayRange,
  computeAtomVisibility,
  firstCoordinationShell,
  isSiteVisibleInDisplay,
  siteNeighborsFullyVisible,
  siteVisibleCoordination,
  visibleSitesInDisplay,
} from '../src/crystal/visibility';
import { createDefaultState } from '../src/state';
import type { StructureId } from '../src/crystal/types';

const IDS: StructureId[] = ['fcc', 'bcc', 'hcp'];
const models = Object.fromEntries(IDS.map((id) => [id, buildCrystal(id)]));

describe('display-only visibility model', () => {
  it('1. keeps the underlying hard-sphere data unchanged', () => {
    for (const id of IDS) {
      const model = models[id];
      expect(model.atoms.every((atom) => atom.radius === 1)).toBe(true);
      expect(minPairDistance(model.atoms)).toBeCloseTo(2, 9);
      expect(clampDisplayRadius(0.2)).toBe(0.5);
      expect(clampDisplayRadius(1.4)).toBe(1);
      expect(clampDisplayRange(0.1)).toBe(0.4);
      expect(clampDisplayRange(2)).toBe(1);
    }
    const defaults = createDefaultState();
    expect(defaults.atomDisplayRadius).toBe(0.68);
    expect(defaults.displayRange).toBe(0.62);
    expect(defaults.displayMode).toBe('range');
    expect(defaults.followRangeForSites).toBe(true);
  });

  it('2. first shell is 13 atoms for FCC/HCP (CN 12) and 9 for BCC (CN 8)', () => {
    const expected: Record<StructureId, { shell: number; cn: number }> = {
      fcc: { shell: 13, cn: 12 },
      bcc: { shell: 9, cn: 8 },
      hcp: { shell: 13, cn: 12 },
    };

    for (const id of IDS) {
      const shell = firstCoordinationShell(models[id].atoms);
      expect(shell.coordination, id).toBe(expected[id].cn);
      expect(shell.neighborIndices.length, id).toBe(expected[id].cn);
      expect(shell.neighborIndices).not.toContain(shell.centerIndex);

      const visibility = computeAtomVisibility(models[id].atoms, 'shell', 0.62);
      expect(visibility.count, id).toBe(expected[id].shell);
      expect(visibility.visible.filter(Boolean).length, id).toBe(expected[id].shell);
      expect(models[id].meta.coordinationNumber, id).toBe(expected[id].cn);
    }
  });

  it('3. range 0.62 shows a sensible centre + first/second shell subset', () => {
    const ranges: Record<StructureId, [number, number]> = {
      fcc: [15, 25],
      bcc: [12, 20],
      hcp: [15, 25],
    };
    for (const id of IDS) {
      const model = models[id];
      const visibility = computeAtomVisibility(model.atoms, 'range', 0.62);
      expect(visibility.count, id).toBeGreaterThanOrEqual(ranges[id][0]);
      expect(visibility.count, id).toBeLessThanOrEqual(ranges[id][1]);
      expect(visibility.count, id).toBeLessThan(model.atoms.length);

      for (let i = 0; i < model.atoms.length; i++) {
        expect(visibility.visible[i], `${id} atom ${i}`).toBe(
          model.atoms[i].radial <= 0.62 + 1e-9,
        );
      }
      const hidden = model.atoms.filter((_, i) => !visibility.visible[i]);
      expect(hidden.length, id).toBeGreaterThan(0);
      expect(hidden.every((atom) => atom.radial > 0.62 + 1e-9), id).toBe(true);
    }

    expect(computeAtomVisibility(models.fcc.atoms, 'all', 0.62).count).toBe(63);
    expect(computeAtomVisibility(models.bcc.atoms, 'all', 0.62).count).toBe(35);
    expect(computeAtomVisibility(models.hcp.atoms, 'all', 0.62).count).toBe(57);
  });

  it('3b. default range gives 19 FCC / 15 BCC / 19 HCP with a symmetric HCP shell', () => {
    const expected: Record<StructureId, number> = { fcc: 19, bcc: 15, hcp: 19 };
    for (const id of IDS) {
      const visibility = computeAtomVisibility(models[id].atoms, 'range', 0.62);
      expect(visibility.count, id).toBe(expected[id]);
    }

    const hcp = models.hcp;
    const visibility = computeAtomVisibility(hcp.atoms, 'range', 0.62);
    const center = visibility.shell.centerAtom;
    expect(center).not.toBeNull();
    if (!center) return;
    // The display translation puts the CN-12 atom exactly at the origin.
    expect(Math.hypot(center.position.x, center.position.y, center.position.z)).toBeLessThan(1e-9);

    const shells = new Map<string, number>();
    const layers = new Map<number, number>();
    for (const index of visibility.indices) {
      const atom = hcp.atoms[index];
      const distance = Math.hypot(
        atom.position.x - center.position.x,
        atom.position.y - center.position.y,
        atom.position.z - center.position.z,
      ).toFixed(6);
      shells.set(distance, (shells.get(distance) ?? 0) + 1);
      layers.set(atom.layer, (layers.get(atom.layer) ?? 0) + 1);
    }
    expect([...shells.values()].sort((a, b) => b - a)).toEqual([12, 6, 1]);
    expect(shells.get('0.000000')).toBe(1);
    expect(shells.get('2.000000')).toBe(12);
    expect(shells.get('2.828427')).toBe(6);
    expect(layers.get(0)).toBe(6);
    expect(layers.get(1)).toBe(7);
    expect(layers.get(2)).toBe(6);
  });

  it('4. interstitial follow-range hides sites with hidden first-shell atoms', () => {
    for (const id of IDS) {
      const model = models[id];
      const visibility = computeAtomVisibility(model.atoms, 'range', 0.62);
      const followed = visibleSitesInDisplay(
        model,
        visibility.visible,
        'range',
        0.62,
        true,
      );
      expect(followed.length, id).toBeGreaterThan(0);
      expect(followed.length, id).toBeLessThan(model.sites.length);
      for (const site of followed) {
        expect(siteNeighborsFullyVisible(site, visibility.visible), id).toBe(true);
        expect(siteVisibleCoordination(site, visibility.visible)).toBe(site.expectedCoordination);
        expect(
          isSiteVisibleInDisplay(
            site,
            model,
            visibility.visible,
            'range',
            0.62,
            true,
          ),
        ).toBe(true);
      }

      const unfollowed = visibleSitesInDisplay(
        model,
        visibility.visible,
        'range',
        0.62,
        false,
      );
      expect(unfollowed.length, id).toBe(model.sites.length);
    }
  });
});
