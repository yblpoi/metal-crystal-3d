import { describe, expect, it } from 'vitest';
import {
  BCC_A,
  BCC_OCTAHEDRAL_RATIO,
  BCC_TETRAHEDRAL_RATIO,
  FCC_A,
  FCC_OCTAHEDRAL_RATIO,
  FCC_TETRAHEDRAL_RATIO,
  HCP_A,
  HCP_C,
  HCP_C_OVER_A,
  STRUCTURE_META,
  buildCrystal,
  enumerateCellSites,
} from '../src/crystal/structures';
import { minPairDistance, validateCrystal } from '../src/crystal/neighbors';
import type { CrystalModel, SiteType, StructureId } from '../src/crystal/types';

const IDS: StructureId[] = ['fcc', 'bcc', 'hcp'];
const models = Object.fromEntries(IDS.map((id) => [id, buildCrystal(id)])) as Record<
  StructureId,
  CrystalModel
>;

const TOL = 1e-5;

describe('metal crystal core', () => {
  it('prints per-structure statistics for manual inspection', () => {
    for (const id of IDS) {
      const model = models[id];
      const oSites = model.sites.filter((s) => s.type === 'O');
      const tSites = model.sites.filter((s) => s.type === 'T');
      const minSiteDistance = Math.min(...model.sites.map((s) => s.minDistance));
      console.log(
        [
          `[${model.meta.abbreviation}]`,
          `atoms=${model.atoms.length}`,
          `O=${oSites.length} (complete ${model.siteCounts.completeO})`,
          `T=${tSites.length} (complete ${model.siteCounts.completeT})`,
          `minAtomDist=${minPairDistance(model.atoms).toFixed(6)}`,
          `minSiteDist=${minSiteDistance.toFixed(6)}`,
          `boundingRadius=${model.boundingRadius.toFixed(6)}`,
        ].join(' '),
      );
    }
  });

  it('1. builds the expected number of cluster atoms', () => {
    expect(models.fcc.atoms).toHaveLength(63);
    expect(models.bcc.atoms).toHaveLength(35);
    expect(models.hcp.atoms).toHaveLength(57);
    for (const id of IDS) {
      expect(models[id].atoms.length).toBe(STRUCTURE_META[id].clusterAtomCount);
    }
  });

  it('2. keeps every pair of atoms at least 2 - 1e-6 apart (no overlap)', () => {
    for (const id of IDS) {
      const d = minPairDistance(models[id].atoms);
      expect(d).toBeGreaterThanOrEqual(2 - 1e-6);
      // Ideal hard spheres touch: the minimum must be exactly 2.
      expect(Math.abs(d - 2)).toBeLessThan(1e-9);
    }
  });

  it('3. gives every atom radius exactly 1', () => {
    for (const id of IDS) {
      for (const atom of models[id].atoms) {
        expect(atom.radius).toBe(1);
      }
    }
  });

  it('4. FCC O/T sites have 6/4 neighbours at the theoretical ratio', () => {
    for (const type of ['O', 'T'] as SiteType[]) {
      const expected = type === 'O' ? 6 : 4;
      const ratio = type === 'O' ? FCC_OCTAHEDRAL_RATIO : FCC_TETRAHEDRAL_RATIO;
      const all = models.fcc.sites.filter((s) => s.type === type);
      const complete = all.filter((s) => s.complete);

      expect(complete.length).toBeGreaterThan(0);
      for (const site of complete) {
        expect(site.coordination).toBe(expected);
        expect(site.neighborDistances).toHaveLength(expected);
        expect(Math.abs(site.minDistance - 1 - ratio)).toBeLessThan(TOL);
        expect(site.theoreticalRadius).toBeCloseTo(ratio, 12);
        expect(site.maxRadius).toBeLessThanOrEqual(ratio + 1e-9);
      }
      for (const site of all) {
        expect(site.coordination).toBeLessThanOrEqual(expected);
        expect(site.minDistance - 1).toBeGreaterThanOrEqual(ratio - TOL);
      }
    }
  });

  it('5. BCC O is a flattened octahedron (2 near + 4 far); T has 4 neighbours', () => {
    const o = models.bcc.sites.find((s) => s.type === 'O' && s.complete);
    expect(o).toBeDefined();
    if (!o) return;

    expect(o.coordination).toBe(6);
    const near = o.neighborDistances.filter((d) => Math.abs(d - BCC_A / 2) < 1e-6);
    const far = o.neighborDistances.filter((d) => Math.abs(d - BCC_A / Math.SQRT2) < 1e-6);
    expect(near).toHaveLength(2);
    expect(far).toHaveLength(4);
    expect(Math.abs(o.minDistance - 1 - BCC_OCTAHEDRAL_RATIO)).toBeLessThan(TOL);

    const t = models.bcc.sites.find((s) => s.type === 'T' && s.complete);
    expect(t).toBeDefined();
    if (!t) return;
    expect(t.coordination).toBe(4);
    for (const d of t.neighborDistances) {
      expect(Math.abs(d - (1 + BCC_TETRAHEDRAL_RATIO))).toBeLessThan(TOL);
    }
    expect(Math.abs(t.minDistance - 1 - BCC_TETRAHEDRAL_RATIO)).toBeLessThan(TOL);
  });

  it('6. HCP O/T sites have 6/4 neighbours and never sit inside an atom', () => {
    for (const type of ['O', 'T'] as SiteType[]) {
      const expected = type === 'O' ? 6 : 4;
      const ratio = type === 'O' ? FCC_OCTAHEDRAL_RATIO : FCC_TETRAHEDRAL_RATIO;
      const all = models.hcp.sites.filter((s) => s.type === type);
      const complete = all.filter((s) => s.complete);

      expect(all.length).toBeGreaterThan(0);
      expect(complete.length).toBeGreaterThan(0);

      for (const site of complete) {
        expect(site.coordination).toBe(expected);
        expect(Math.abs(site.minDistance - 1 - ratio)).toBeLessThan(TOL);
      }
      for (const site of all) {
        expect(site.minDistance).toBeGreaterThan(1);
        expect(site.coordination).toBeLessThanOrEqual(expected);
        expect(site.minDistance - 1).toBeGreaterThanOrEqual(ratio - TOL);
      }
    }
  });

  it('7. per-cell site counts match the textbook values', () => {
    expect(enumerateCellSites('fcc', 1)).toEqual({ O: 4, T: 8 });
    expect(enumerateCellSites('bcc', 1)).toEqual({ O: 6, T: 12 });
    expect(enumerateCellSites('hcp', 1)).toEqual({ O: 2, T: 4 });

    expect(STRUCTURE_META.fcc.atomsPerConventionalCell).toBe(4);
    expect(STRUCTURE_META.bcc.atomsPerConventionalCell).toBe(2);
    expect(STRUCTURE_META.hcp.atomsPerPrimitiveCell).toBe(2);
    expect(STRUCTURE_META.hcp.atomsPerConventionalCell).toBe(6);

    // A hexagonal prism contains three primitive cells.
    expect(STRUCTURE_META.hcp.octahedralPerConventionalCell).toBe(
      STRUCTURE_META.hcp.octahedralPerPrimitiveCell * 3,
    );
    expect(STRUCTURE_META.hcp.tetrahedralPerConventionalCell).toBe(
      STRUCTURE_META.hcp.tetrahedralPerPrimitiveCell * 3,
    );
    expect(STRUCTURE_META.hcp.octahedralPerPrimitiveCell).toBe(2);
    expect(STRUCTURE_META.hcp.tetrahedralPerPrimitiveCell).toBe(4);
  });

  it('8. APF, a/r and c/a match theory', () => {
    const sphere = (n: number) => (n * 4 * Math.PI) / 3; // r = 1

    const fccApf = sphere(4) / FCC_A ** 3;
    expect(Math.abs(fccApf - Math.PI / (3 * Math.SQRT2))).toBeLessThan(1e-12);
    expect(FCC_A / 1).toBeCloseTo(2 * Math.SQRT2, 10);
    expect(FCC_OCTAHEDRAL_RATIO).toBeCloseTo(Math.SQRT2 - 1, 12);
    expect(FCC_TETRAHEDRAL_RATIO).toBeCloseTo(Math.sqrt(1.5) - 1, 12);

    const bccApf = sphere(2) / BCC_A ** 3;
    expect(Math.abs(bccApf - (Math.PI * Math.sqrt(3)) / 8)).toBeLessThan(1e-12);
    expect(BCC_A).toBeCloseTo(4 / Math.sqrt(3), 10);
    expect(BCC_OCTAHEDRAL_RATIO).toBeCloseTo(2 / Math.sqrt(3) - 1, 12);
    expect(BCC_TETRAHEDRAL_RATIO).toBeCloseTo(Math.sqrt(5 / 3) - 1, 12);

    const hexArea = ((3 * Math.sqrt(3)) / 2) * HCP_A ** 2;
    const hcpApf = sphere(6) / (hexArea * HCP_C);
    expect(Math.abs(hcpApf - Math.PI / (3 * Math.SQRT2))).toBeLessThan(1e-12);
    expect(HCP_C_OVER_A).toBeCloseTo(Math.sqrt(8 / 3), 12);
    expect(HCP_C).toBeCloseTo(3.2659863237, 9);
    expect(STRUCTURE_META.hcp.lattice.cOverA).toBeCloseTo(Math.sqrt(8 / 3), 12);

    expect(STRUCTURE_META.fcc.apf).toBeCloseTo(0.74048, 5);
    expect(STRUCTURE_META.bcc.apf).toBeCloseTo(0.68017, 5);
    expect(STRUCTURE_META.hcp.apf).toBeCloseTo(0.74048, 5);
  });

  it('9. validates every model and its stable ids', () => {
    for (const id of IDS) {
      const result = validateCrystal(models[id]);
      if (!result.ok) {
        console.error(result.issues);
      }
      expect(result.ok).toBe(true);
    }

    // Ids must be unique and stable across rebuilds.
    for (const id of IDS) {
      const again = buildCrystal(id);
      const atomIds = models[id].atoms.map((a) => a.id);
      expect(new Set(atomIds).size).toBe(atomIds.length);
      expect(again.atoms.map((a) => a.id)).toEqual(atomIds);

      const siteIds = models[id].sites.map((s) => s.id);
      expect(new Set(siteIds).size).toBe(siteIds.length);
      expect(again.sites.map((s) => s.id)).toEqual(siteIds);
    }
  });

  it('10. HCP layers are regular hexagons (convex hull: 6 equal edges, 6 equal radii)', () => {
    interface Pt {
      x: number;
      y: number;
    }
    const cross = (o: Pt, a: Pt, b: Pt) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    // Andrew's monotone chain; pure TS so the test does not depend on a hull library.
    const convexHull = (input: Pt[]): Pt[] => {
      const points = [...input].sort((a, b) => a.x - b.x || a.y - b.y);
      const lower: Pt[] = [];
      for (const point of points) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-12) {
          lower.pop();
        }
        lower.push(point);
      }
      const upper: Pt[] = [];
      for (let i = points.length - 1; i >= 0; i--) {
        const point = points[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-12) {
          upper.pop();
        }
        upper.push(point);
      }
      lower.pop();
      upper.pop();
      return [...lower, ...upper];
    };

    const layers = [0, 1, 2].map((layer) =>
      models.hcp.atoms.filter((atom) => atom.layer === layer),
    );
    expect(layers.map((layer) => layer.length)).toEqual([19, 19, 19]);

    for (const atoms of layers) {
      const hull = convexHull(atoms.map((atom) => ({ x: atom.position.x, y: atom.position.y })));
      expect(hull).toHaveLength(6);

      const edgeLengths = hull.map((vertex, index) => {
        const next = hull[(index + 1) % hull.length];
        return Math.hypot(next.x - vertex.x, next.y - vertex.y);
      });
      const firstEdge = edgeLengths[0];
      for (const edge of edgeLengths) {
        expect(Math.abs(edge - firstEdge)).toBeLessThan(1e-6);
      }
      // a = 2, cluster hexagon side = 2a = 4.
      expect(Math.abs(firstEdge - 4)).toBeLessThan(1e-6);

      const centre = hull.reduce(
        (sum, vertex) => ({ x: sum.x + vertex.x / hull.length, y: sum.y + vertex.y / hull.length }),
        { x: 0, y: 0 },
      );
      const radii = hull.map((vertex) => Math.hypot(vertex.x - centre.x, vertex.y - centre.y));
      for (const radius of radii) {
        expect(Math.abs(radius - radii[0])).toBeLessThan(1e-6);
      }
      expect(Math.abs(radii[0] - 4)).toBeLessThan(1e-6);
    }

    // Extent from the CN-12 display origin including r = 1 atoms is
    // sqrt(28) + 1 = 6.2915; the old elongated region produced 8.416.
    const extent = models.hcp.boundingRadius + 1;
    expect(extent).toBeGreaterThan(6.2);
    expect(extent).toBeLessThan(6.4);
  });

  it('11. HCP interstitial filter uses the same regular-hexagon norm as the atoms', () => {
    const model = models.hcp;
    expect(model.sites.length).toBeGreaterThan(0);
    for (const site of model.sites) {
      expect(site.minDistance).toBeGreaterThan(1);
      expect(site.coordination).toBeLessThanOrEqual(site.expectedCoordination);
      // Every site must sit inside the same six-sided region as the cluster.
      expect(Math.abs(site.fractional.x)).toBeLessThanOrEqual(2 + 1e-9);
      expect(Math.abs(site.fractional.y)).toBeLessThanOrEqual(2 + 1e-9);
      expect(Math.abs(site.fractional.x - site.fractional.y)).toBeLessThanOrEqual(2 + 1e-9);
      expect(site.fractional.z).toBeGreaterThanOrEqual(-1e-9);
      expect(site.fractional.z).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(model.siteCounts.completeO).toBeGreaterThan(0);
    expect(model.siteCounts.completeT).toBeGreaterThan(0);
    expect(validateCrystal(model).ok).toBe(true);
  });

  it('12. puts the atom nearest the old bbox centre at the display origin', () => {
    // FCC/BCC have an atom at the bbox centre, so their bbox stays centred.
    // HCP does not: the A-B-A bbox centre is 1/sqrt(3) above the central B
    // atom, so the whole cluster is translated by that amount and the bbox
    // midpoint moves with it. This is the deliberate display translation.
    const expectedYMid: Record<StructureId, number> = {
      fcc: 0,
      bcc: 0,
      hcp: -1 / Math.sqrt(3),
    };
    for (const id of IDS) {
      const xs = models[id].atoms.map((a) => a.position.x);
      const ys = models[id].atoms.map((a) => a.position.y);
      const zs = models[id].atoms.map((a) => a.position.z);
      const mid = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2;
      expect(Math.abs(mid(xs)), id).toBeLessThan(1e-9);
      expect(mid(ys), id).toBeCloseTo(expectedYMid[id], 9);
      expect(Math.abs(mid(zs)), id).toBeLessThan(1e-9);

      const originAtom = models[id].atoms.find(
        (atom) =>
          Math.hypot(atom.position.x, atom.position.y, atom.position.z) < 1e-9,
      );
      expect(originAtom, id).toBeDefined();

      const maxRadius = Math.max(
        ...models[id].atoms.map((a) => Math.hypot(a.position.x, a.position.y, a.position.z)),
      );
      expect(models[id].boundingRadius).toBeCloseTo(maxRadius, 12);
    }
  });
});
