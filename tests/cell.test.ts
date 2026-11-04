import { describe, expect, it } from 'vitest';
import { HCP_A, HCP_LATTICE_VECTORS, buildCrystal } from '../src/crystal/structures';
import { firstCoordinationShell } from '../src/crystal/visibility';
import {
  CellLayer,
  HCP_PRISM_HEX,
  cellWireRadius,
  cornerOffset,
  cornerSurfaceGap,
  cornerTick,
} from '../src/scene/cell';
import type { Vec3 } from '../src/crystal/types';

function cartesian(v: Vec3): Vec3 {
  return {
    x: HCP_LATTICE_VECTORS.a1.x * v.x + HCP_LATTICE_VECTORS.a2.x * v.y,
    y: HCP_LATTICE_VECTORS.a1.y * v.x + HCP_LATTICE_VECTORS.a2.y * v.y,
    z: 0,
  };
}

function polygonArea(points: Vec3[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

describe('HCP conventional prism wireframe', () => {
  it('is a regular hexagon of side a enclosing exactly three primitive cells', () => {
    expect(HCP_PRISM_HEX).toHaveLength(6);
    const points = HCP_PRISM_HEX.map(cartesian);
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(HCP_A, 10);
    }

    const { a1, a2 } = HCP_LATTICE_VECTORS;
    const primitiveArea = Math.abs(a1.x * a2.y - a1.y * a2.x);
    expect(polygonArea(points) / primitiveArea).toBeCloseTo(3, 10);
  });

  it('places every prism corner and face centre on an A-layer atom', () => {
    const model = buildCrystal('hcp');
    const aAtoms = model.atoms.filter((atom) => atom.kind === 'A');
    for (const vertex of HCP_PRISM_HEX) {
      for (const z of [0, 1]) {
        const match = aAtoms.find(
          (atom) =>
            Math.abs(atom.fractional.x - vertex.x) < 1e-9 &&
            Math.abs(atom.fractional.y - vertex.y) < 1e-9 &&
            Math.abs(atom.fractional.z - z) < 1e-9,
        );
        expect(match, `missing A atom at (${vertex.x}, ${vertex.y}, ${z})`).toBeDefined();
      }
    }
    // Both face centres on the prism axis (bottom and top A layers) are atoms too.
    for (const z of [0, 1]) {
      const match = aAtoms.find(
        (atom) =>
          Math.abs(atom.fractional.x) < 1e-9 &&
          Math.abs(atom.fractional.y) < 1e-9 &&
          Math.abs(atom.fractional.z - z) < 1e-9,
      );
      expect(match, `missing face-centre A atom at (0, 0, ${z})`).toBeDefined();
    }
  });

  it('holds exactly three interior B atoms at mid-height', () => {
    const model = buildCrystal('hcp');
    const bAtoms = model.atoms.filter((atom) => atom.kind === 'B');
    const anchor = model.atoms.find(
      (atom) => atom.kind === 'A' && Math.abs(atom.fractional.x) < 1e-9 && Math.abs(atom.fractional.y) < 1e-9 && Math.abs(atom.fractional.z) < 1e-9,
    );
    expect(anchor).toBeDefined();
    if (!anchor) return;
    const { a1, a2 } = HCP_LATTICE_VECTORS;
    const inside = bAtoms.filter((atom) => {
      const u = atom.fractional.x - anchor.fractional.x;
      const v = atom.fractional.y - anchor.fractional.y;
      const x = a1.x * u + a2.x * v;
      const y = a1.y * u + a2.y * v;
      return Math.hypot(x, y) <= HCP_A + 1e-9 && Math.abs(atom.fractional.z - 0.5) < 1e-9;
    });
    expect(inside).toHaveLength(3);
    for (const atom of inside) {
      const distance = Math.hypot(
        a1.x * (atom.fractional.x - anchor.fractional.x) + a2.x * (atom.fractional.y - anchor.fractional.y),
        a1.y * (atom.fractional.x - anchor.fractional.x) + a2.y * (atom.fractional.y - anchor.fractional.y),
      );
      expect(distance).toBeCloseTo(HCP_A / Math.sqrt(3), 9);
    }
  });

  it('anchors the HCP prism on the bottom A-layer column next to the centre', () => {
    const model = buildCrystal('hcp');
    const shell = firstCoordinationShell(model.atoms);
    expect(shell.centerAtom).not.toBeNull();
    if (!shell.centerAtom) return;
    // The cluster centre is still the CN-12 B atom at the origin.
    expect(
      Math.hypot(
        shell.centerAtom.position.x,
        shell.centerAtom.position.y,
        shell.centerAtom.position.z,
      ),
    ).toBeLessThan(1e-9);

    const layer = new CellLayer();
    layer.build(model);
    const anchor = layer.getAnchorPosition();
    const anchorAtom = model.atoms.find(
      (atom) =>
        Math.abs(atom.position.x - anchor[0]) < 1e-9 &&
        Math.abs(atom.position.y - anchor[1]) < 1e-9 &&
        Math.abs(atom.position.z - anchor[2]) < 1e-9,
    );
    expect(anchorAtom, 'the HCP anchor must be an atom').toBeDefined();
    expect(anchorAtom?.kind).toBe('A');
    // Bottom A layer, one c below the prism's top A layer.
    expect(anchor[2]).toBeCloseTo(-HCP_LATTICE_VECTORS.c.z / 2, 9);
    // Nearest A columns are a/sqrt(3) from the cluster centre in-plane.
    expect(Math.hypot(anchor[0], anchor[1])).toBeCloseTo(HCP_A / Math.sqrt(3), 9);
    const info = layer.getInfo();
    expect(info.cornerMarks).toBe(0);
    expect(info.boundsRadius).toBeCloseTo(cellWireRadius(model), 9);
    layer.dispose();
  });
});

describe('cell corner ticks', () => {
  it('follow the display radius and stay out of the fit radius', () => {
    expect(cornerOffset(0.68)).toBeCloseTo(0.7616, 9);
    expect(cornerTick(0.68)).toBeCloseTo(0.1088, 9);
    expect(cornerTick(0.5)).toBeCloseTo(0.08, 9);
    expect(cornerSurfaceGap(0.68)).toBeLessThan(0.12);
    expect(cornerSurfaceGap(0.5)).toBeLessThan(0.12);

    const model = buildCrystal('fcc');
    const layer = new CellLayer();
    layer.build(model);
    layer.setDisplayRadius(0.68);
    const info = layer.getInfo();
    expect(info.cornerMarks).toBe(8);
    expect(info.cornerSurfaceGap).toBeLessThan(0.12);
    expect(info.cornerOffset).toBeCloseTo(0.68 * 1.12, 9);
    expect(info.cornerTick).toBeCloseTo(0.68 * 0.16, 9);
    expect(info.boundsRadius).toBeCloseTo(cellWireRadius(model), 9);
    expect(info.boundsRadius).toBeLessThan(info.cornerBoundsRadius);

    layer.setDisplayRadius(1);
    expect(layer.getInfo().cornerOffset).toBeCloseTo(1.12, 9);
    expect(layer.getInfo().cornerSurfaceGap).toBeCloseTo(0.12, 9);
    layer.dispose();
  });
});
