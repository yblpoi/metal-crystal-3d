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

  it('places every vertical edge through a B-layer atom column at mid-height', () => {
    const model = buildCrystal('hcp');
    for (const vertex of HCP_PRISM_HEX) {
      const match = model.atoms.find(
        (atom) =>
          Math.abs(atom.fractional.x - (1 / 3 + vertex.x)) < 1e-9 &&
          Math.abs(atom.fractional.y - (2 / 3 + vertex.y)) < 1e-9 &&
          Math.abs(atom.fractional.z - 0.5) < 1e-9,
      );
      expect(
        match,
        `missing atom at (${1 / 3 + vertex.x}, ${2 / 3 + vertex.y}, 0.5)`,
      ).toBeDefined();
    }
  });

  it('anchors the HCP prism on the CN-12 centre atom', () => {
    const model = buildCrystal('hcp');
    const shell = firstCoordinationShell(model.atoms);
    expect(shell.centerAtom).not.toBeNull();
    if (!shell.centerAtom) return;
    expect(shell.centerAtom.position.x).toBeCloseTo(0, 9);
    expect(shell.centerAtom.position.y).toBeCloseTo(0, 9);
    expect(shell.centerAtom.position.z).toBeCloseTo(0, 9);

    const layer = new CellLayer();
    layer.build(model);
    const anchor = layer.getAnchorPosition();
    expect(anchor[0]).toBeCloseTo(shell.centerAtom.position.x, 9);
    expect(anchor[1]).toBeCloseTo(shell.centerAtom.position.y, 9);
    expect(anchor[2]).toBeCloseTo(shell.centerAtom.position.z, 9);
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
