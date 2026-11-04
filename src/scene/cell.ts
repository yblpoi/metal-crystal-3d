import { Group, NormalBlending, Vector3 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { Atom, CrystalModel, Vec3 } from '../crystal/types';

/**
 * Two-stroke cell frame:
 * - a dark teal core that stays readable on a white background;
 * - a wide, light halo with NormalBlending that stays readable on the deep
 *   navy stage. Additive blending was the old failure mode: on white it turned
 *   into grey-blue fog, so the halo is deliberately normal-blended.
 */
const CORE_COLOR = 0x2f6b82;
const HALO_COLOR = 0xd8f3ff;
const LINE_DASH = 0.12;
const LINE_GAP = 0.07;
const CORE_RATIO = 0.7;
const HALO_RATIO = 1.6;
const INNER_RATIO = 2 / 3;
const HALO_OPACITY_BASE = 0.18;
const HALO_OPACITY_GAIN = 0.07;
const CORNER_OFFSET_RATIO = 1.12;
const CORNER_TICK_RATIO = 0.16;
const CORNER_TICK_MIN = 0.08;
const CORNER_CORE_WIDTH = 1.8;
const CORNER_HALO_WIDTH = 2.8;
const DEFAULT_WIDTH = 2.8;
const DEFAULT_BRIGHTNESS = 0.82;

/** Anchor distance from the atom centre, as a multiple of the display radius. */
export function cornerOffset(displayRadius: number): number {
  return Math.max(0, displayRadius) * CORNER_OFFSET_RATIO;
}

/** Tick length, proportional to the display radius with a small floor. */
export function cornerTick(displayRadius: number): number {
  return Math.max(CORNER_TICK_MIN, Math.max(0, displayRadius) * CORNER_TICK_RATIO);
}

/** Distance from the tick anchor to the sphere surface at the same corner. */
export function cornerSurfaceGap(displayRadius: number): number {
  return Math.max(0, cornerOffset(displayRadius) - displayRadius);
}

interface Edge {
  a: Vec3;
  b: Vec3;
  inner: boolean;
}

interface CornerAnchor {
  centre: Vector3;
  outward: Vector3;
  /** Atom at this cell corner; hidden atoms hide their tick instead of leaving debris. */
  atomIndex: number;
}

interface CellGeometry {
  anchor: Vector3;
  outer: number[];
  inner: number[];
  corners: CornerAnchor[];
  axes: Vector3[];
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/** Atom that defines the cell origin in cluster coordinates. */
function cellAnchorAtom(model: CrystalModel) {
  if (model.id === 'hcp') {
    // The hexagonal prism cell is bounded by A layers: its 12 corners and both
    // face centres are A atoms, and its axis runs through an A column. The
    // cluster origin is the central B atom, so the nearest A columns are
    // a/sqrt(3) away. Pick the bottom-layer column closest to the origin
    // (ties broken by y then x) so the frame is deterministic.
    const bottomZ = Math.min(...model.atoms.map((atom) => atom.position.z));
    const bottom = model.atoms.filter((atom) => close(atom.position.z, bottomZ));
    const inPlane = (atom: Atom) => Math.hypot(atom.position.x, atom.position.y);
    bottom.sort(
      (a, b) => inPlane(a) - inPlane(b) || a.position.y - b.position.y || a.position.x - b.position.x,
    );
    if (bottom.length > 0) return bottom[0];
  }
  return (
    model.atoms.find(
      (candidate) =>
        close(candidate.fractional.x, 0) &&
        close(candidate.fractional.y, 0) &&
        close(candidate.fractional.z, 0),
    ) ?? model.atoms[0]
  );
}

function toWorld(anchor: Vector3, vectors: [Vec3, Vec3, Vec3], f: Vec3): Vector3 {
  return new Vector3(
    anchor.x + vectors[0].x * f.x + vectors[1].x * f.y + vectors[2].x * f.z,
    anchor.y + vectors[0].y * f.x + vectors[1].y * f.y + vectors[2].y * f.z,
    anchor.z + vectors[0].z * f.x + vectors[1].z * f.y + vectors[2].z * f.z,
  );
}

/**
 * Cube frame covering repeat x repeat x repeat conventional cells.
 * repeat = 1 is one unit cell (12 edges, no interior planes); repeat = 2 is
 * the 2x2x2 supercell (12 outer edges + one mid-plane per axis). Coordinates
 * are lattice units, so every edge keeps the same length and every corner
 * stays 90 degrees: the frame can never be squashed into a box.
 */
function cubicEdges(repeat: number): Edge[] {
  const outer: Edge[] = [];
  const inner: Edge[] = [];
  const corners: Vec3[] = [];
  for (const x of [0, repeat]) {
    for (const y of [0, repeat]) {
      for (const z of [0, repeat]) corners.push({ x, y, z });
    }
  }
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const a = corners[i];
      const b = corners[j];
      const diff = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
      if (diff === repeat) outer.push({ a, b, inner: false });
    }
  }

  // Interior lattice planes outline the division between the conventional
  // cells: none for a single cell, repeat - 1 per axis for the supercell.
  for (let t = 1; t < repeat; t++) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const plane: Vec3[] = [];
      for (const u of [0, repeat]) {
        for (const v of [0, repeat]) {
          const point: Vec3 = { x: t, y: t, z: t };
          if (axis === 'x') {
            point.y = u;
            point.z = v;
          } else if (axis === 'y') {
            point.x = u;
            point.z = v;
          } else {
            point.x = u;
            point.y = v;
          }
          plane.push(point);
        }
      }
      plane.sort((p, q) => p.x + p.y + p.z - (q.x + q.y + q.z));
      inner.push({ a: plane[0], b: plane[1], inner: true });
      inner.push({ a: plane[1], b: plane[3], inner: true });
      inner.push({ a: plane[3], b: plane[2], inner: true });
      inner.push({ a: plane[2], b: plane[0], inner: true });
    }
  }

  return [...outer, ...inner];
}

/**
 * Regular hexagon of side a (3 primitive cells / 6 atoms), expressed as
 * offsets from the cell anchor in primitive (u,v) coordinates. Exported so the
 * geometry can be area-checked in unit tests.
 */
export const HCP_PRISM_HEX: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 1, y: 1, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: -1, y: -1, z: 0 },
  { x: 0, y: -1, z: 0 },
];

/**
 * Hexagonal prism cell on the A sublattice: the bottom ring is the A layer at
 * the anchor, the top ring is the next A layer one c above, and the six
 * vertical edges are A atomic columns. Corners and the two face centres are A
 * atoms; the three interior B atoms sit at mid-height (z offset 1/2), where the
 * dashed inner ring marks the B layer plane.
 */
function hcpEdges(): Edge[] {
  const hex = HCP_PRISM_HEX;
  const edges: Edge[] = [];
  for (const z of [0, 1]) {
    for (let i = 0; i < hex.length; i++) {
      const a = hex[i];
      const b = hex[(i + 1) % hex.length];
      edges.push({ a: { ...a, z }, b: { ...b, z }, inner: false });
    }
  }
  for (const vertex of hex) {
    edges.push({
      a: { ...vertex, z: 0 },
      b: { ...vertex, z: 1 },
      inner: false,
    });
  }
  // Decorative mid-plane at the B layer (z = 1/2): it is not an atom plane,
  // it only shows where the three interior B atoms sit inside the prism.
  for (let i = 0; i < hex.length; i++) {
    const a = hex[i];
    const b = hex[(i + 1) % hex.length];
    edges.push({ a: { ...a, z: 0.5 }, b: { ...b, z: 0.5 }, inner: true });
  }
  return edges;
}

function radiusOf(positions: number[]): number {
  let max = 0;
  for (let i = 0; i < positions.length; i += 3) {
    max = Math.max(max, Math.hypot(positions[i], positions[i + 1], positions[i + 2]));
  }
  return max;
}

function buildCellGeometry(model: CrystalModel): CellGeometry {
  const anchorAtom = cellAnchorAtom(model);
  const anchor = new Vector3(
    anchorAtom.position.x,
    anchorAtom.position.y,
    anchorAtom.position.z,
  );
  const vectors = model.meta.lattice.vectors;
  const axes = vectors.map((vector) =>
    new Vector3(vector.x, vector.y, vector.z).normalize(),
  );
  const cubic = model.meta.lattice.kind === 'cubic';
  const repeat = cubic ? (model.cellRepeat === 1 ? 1 : 2) : 1;
  const edges = cubic ? cubicEdges(repeat) : hcpEdges();
  const outer: number[] = [];
  const inner: number[] = [];

  for (const edge of edges) {
    const a = toWorld(anchor, vectors, edge.a);
    const b = toWorld(anchor, vectors, edge.b);
    const target = edge.inner ? inner : outer;
    target.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  const corners: CornerAnchor[] = [];
  if (cubic) {
    const half = repeat / 2;
    const centre = toWorld(anchor, vectors, { x: half, y: half, z: half });
    for (const x of [0, repeat]) {
      for (const y of [0, repeat]) {
        for (const z of [0, repeat]) {
          const corner = toWorld(anchor, vectors, { x, y, z });
          const atomIndex = model.atoms.findIndex(
            (atom) =>
              close(atom.fractional.x, x) &&
              close(atom.fractional.y, y) &&
              close(atom.fractional.z, z),
          );
          corners.push({
            centre: corner,
            outward: corner.clone().sub(centre).normalize(),
            atomIndex,
          });
        }
      }
    }
  }
  // HCP: all twelve prism corners and both face centres already coincide with
  // A atoms, so the frame needs no floating corner ticks.

  return { anchor, outer, inner, corners, axes };
}

/** Radius of the cell frame alone (corner ticks excluded), around the origin. */
export function cellWireRadius(model: CrystalModel): number {
  const geometry = buildCellGeometry(model);
  return Math.max(radiusOf(geometry.outer), radiusOf(geometry.inner));
}

function setLineWidth(material: LineMaterial, width: number): void {
  material.uniforms.linewidth.value = width;
}

function lineMaterial(
  options: ConstructorParameters<typeof LineMaterial>[0],
  width: number,
): LineMaterial {
  const material = new LineMaterial({
    ...options,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  setLineWidth(material, width);
  return material;
}

/**
 * Cell wireframe computed from lattice vectors and fractional coordinates.
 * Cubic: repeat^3 conventional cells (1x1x1 or 2x2x2) plus interior planes.
 * HCP: one hexagonal prism (three primitive cells) whose axis runs through a
 * bottom A-layer column, so every corner and face centre is an A atom.
 *
 * Each stroke is a LineSegments2 ribbon (real pixel widths) with depth testing
 * on by default: lines hide behind atoms and stay visible in the gaps. The
 * light halo is normal-blended, not additive, so a white export background
 * still shows the dark core instead of grey fog.
 */
export class CellLayer {
  readonly group = new Group();
  private readonly outerCoreMaterial = lineMaterial(
    {
      color: CORE_COLOR,
      dashed: true,
      dashSize: LINE_DASH,
      gapSize: LINE_GAP,
      opacity: DEFAULT_BRIGHTNESS,
      depthTest: true,
      blending: NormalBlending,
    },
    DEFAULT_WIDTH * CORE_RATIO,
  );
  private readonly outerHaloMaterial = lineMaterial(
    {
      color: HALO_COLOR,
      dashed: true,
      dashSize: LINE_DASH,
      gapSize: LINE_GAP,
      opacity: HALO_OPACITY_BASE + DEFAULT_BRIGHTNESS * HALO_OPACITY_GAIN,
      depthTest: true,
      blending: NormalBlending,
    },
    DEFAULT_WIDTH * HALO_RATIO,
  );
  private readonly innerCoreMaterial = lineMaterial(
    {
      color: CORE_COLOR,
      dashed: true,
      dashSize: LINE_DASH,
      gapSize: LINE_GAP,
      opacity: DEFAULT_BRIGHTNESS * 0.42,
      depthTest: true,
      blending: NormalBlending,
    },
    DEFAULT_WIDTH * CORE_RATIO * INNER_RATIO,
  );
  private readonly innerHaloMaterial = lineMaterial(
    {
      color: HALO_COLOR,
      dashed: true,
      dashSize: LINE_DASH,
      gapSize: LINE_GAP,
      opacity: (HALO_OPACITY_BASE + DEFAULT_BRIGHTNESS * HALO_OPACITY_GAIN) * 0.5,
      depthTest: true,
      blending: NormalBlending,
    },
    DEFAULT_WIDTH * HALO_RATIO * INNER_RATIO,
  );
  private readonly cornerCoreMaterial = lineMaterial(
    {
      color: CORE_COLOR,
      dashed: false,
      opacity: 0.82,
      depthTest: true,
      blending: NormalBlending,
    },
    CORNER_CORE_WIDTH,
  );
  private readonly cornerHaloMaterial = lineMaterial(
    {
      color: HALO_COLOR,
      dashed: false,
      opacity: 0.2,
      depthTest: true,
      blending: NormalBlending,
    },
    CORNER_HALO_WIDTH,
  );

  private readonly resolution = { width: 1, height: 1 };
  private readonly anchor = new Vector3();
  private axes: Vector3[] = [];
  private cornerAnchors: CornerAnchor[] = [];
  private atomVisible: boolean[] = [];
  private cornerHalo: LineSegments2 | null = null;
  private cornerCore: LineSegments2 | null = null;
  private lineWidth = DEFAULT_WIDTH;
  private brightness = DEFAULT_BRIGHTNESS;
  private displayRadius = 0.68;
  private cornerCount = 0;
  private boundsRadius = 0;
  private cornerBoundsRadius = 0;
  private xray = false;

  build(model: CrystalModel): void {
    this.clear();
    this.atomVisible = [];
    const geometry = buildCellGeometry(model);
    this.anchor.copy(geometry.anchor);
    this.axes = geometry.axes;
    this.cornerAnchors = geometry.corners;
    this.boundsRadius = Math.max(
      radiusOf(geometry.outer),
      radiusOf(geometry.inner),
    );

    // Halo first so the crisp core sits on top of its own soft edge.
    this.group.add(
      this.createLines(geometry.outer, this.outerHaloMaterial, 1, true),
      this.createLines(geometry.outer, this.outerCoreMaterial, 2, true),
      this.createLines(geometry.inner, this.innerHaloMaterial, 3, true),
      this.createLines(geometry.inner, this.innerCoreMaterial, 4, true),
    );
    this.rebuildCorners();
    this.cornerBoundsRadius = this.computeCornerBoundsRadius();
    this.setResolution(this.resolution.width, this.resolution.height);
    this.applyStyle();
  }

  private createLines(
    positions: number[],
    material: LineMaterial,
    order: number,
    dashed: boolean,
  ): LineSegments2 {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions.length > 0 ? positions : [0, 0, 0, 0, 0, 0]);
    const lines = new LineSegments2(geometry, material);
    if (dashed && positions.length > 0) lines.computeLineDistances();
    lines.visible = positions.length > 0;
    lines.renderOrder = order;
    lines.frustumCulled = false;
    return lines;
  }

  private cornerPositions(): number[] {
    const positions: number[] = [];
    const offset = cornerOffset(this.displayRadius);
    const tick = cornerTick(this.displayRadius);
    for (const anchor of this.cornerAnchors) {
      if (anchor.atomIndex >= 0 && this.atomVisible[anchor.atomIndex] === false) continue;
      const point = anchor.centre.clone().addScaledVector(anchor.outward, offset);
      for (const axis of this.axes) {
        const direction = axis.clone();
        if (direction.dot(anchor.outward) < 0) direction.negate();
        positions.push(
          point.x,
          point.y,
          point.z,
          point.x + direction.x * tick,
          point.y + direction.y * tick,
          point.z + direction.z * tick,
        );
      }
    }
    return positions;
  }

  private rebuildCorners(): void {
    this.removeCornerLines();
    const positions = this.cornerPositions();
    this.cornerHalo = this.createLines(positions, this.cornerHaloMaterial, 5, false);
    this.cornerCore = this.createLines(positions, this.cornerCoreMaterial, 6, false);
    this.group.add(this.cornerHalo, this.cornerCore);
    this.cornerCount = positions.length / 18;
  }

  private removeCornerLines(): void {
    for (const line of [this.cornerHalo, this.cornerCore]) {
      if (!line) continue;
      this.group.remove(line);
      line.geometry.dispose();
    }
    this.cornerHalo = null;
    this.cornerCore = null;
  }

  private computeCornerBoundsRadius(): number {
    const offset = cornerOffset(this.displayRadius);
    const tick = cornerTick(this.displayRadius);
    let max = this.boundsRadius;
    for (const anchor of this.cornerAnchors) {
      max = Math.max(max, anchor.centre.length() + offset + tick);
    }
    return max;
  }

  /**
   * Ticks are decorative anchors for the cell corners. When the corner atom
   * is hidden by the display range there is no sphere to hug, and the tick
   * reads as a floating fragment, so it is omitted entirely.
   */
  setAtomVisibility(visible: boolean[]): void {
    if (
      this.atomVisible.length === visible.length &&
      this.atomVisible.every((value, index) => value === visible[index])
    ) {
      return;
    }
    this.atomVisible = visible.slice();
    this.rebuildCorners();
    this.cornerBoundsRadius = this.computeCornerBoundsRadius();
  }

  /** Rebuilds only the corner ticks; the main frame geometry is unchanged. */
  setDisplayRadius(radius: number): void {
    const next = Math.min(1, Math.max(0.5, radius));
    if (Math.abs(next - this.displayRadius) < 1e-9) return;
    this.displayRadius = next;
    this.rebuildCorners();
    this.cornerBoundsRadius = this.computeCornerBoundsRadius();
  }

  setStyle(width: number, brightness: number): void {
    this.lineWidth = Math.min(6, Math.max(1, width));
    this.brightness = Math.min(1, Math.max(0.3, brightness));
    this.applyStyle();
  }

  private applyStyle(): void {
    const depthTest = !this.xray;
    const coreWidth = Math.max(1.2, this.lineWidth * CORE_RATIO);
    const haloWidth = Math.max(2.2, this.lineWidth * HALO_RATIO);
    const innerCoreWidth = Math.max(1, coreWidth * INNER_RATIO);
    const innerHaloWidth = Math.max(1.6, haloWidth * INNER_RATIO);
    const haloOpacity = Math.min(
      0.25,
      Math.max(0.18, HALO_OPACITY_BASE + this.brightness * HALO_OPACITY_GAIN),
    );

    setLineWidth(this.outerCoreMaterial, coreWidth);
    setLineWidth(this.outerHaloMaterial, haloWidth);
    setLineWidth(this.innerCoreMaterial, innerCoreWidth);
    setLineWidth(this.innerHaloMaterial, innerHaloWidth);
    setLineWidth(this.cornerCoreMaterial, CORNER_CORE_WIDTH);
    setLineWidth(this.cornerHaloMaterial, CORNER_HALO_WIDTH);

    this.outerCoreMaterial.opacity = this.brightness;
    this.outerHaloMaterial.opacity = haloOpacity;
    this.innerCoreMaterial.opacity = this.brightness * 0.42;
    this.innerHaloMaterial.opacity = haloOpacity * 0.5;
    this.cornerCoreMaterial.opacity = this.xray ? 0.55 : 0.82;
    this.cornerHaloMaterial.opacity = this.xray ? 0.06 : 0.2;

    for (const material of [
      this.outerCoreMaterial,
      this.outerHaloMaterial,
      this.innerCoreMaterial,
      this.innerHaloMaterial,
      this.cornerCoreMaterial,
      this.cornerHaloMaterial,
    ]) {
      material.depthTest = depthTest;
    }
  }

  setXray(enabled: boolean): void {
    this.xray = enabled;
    this.applyStyle();
  }

  /**
   * LineMaterial resolution is in CSS viewport pixels; LineSegments2 derives
   * the drawing-buffer scale from the renderer each frame. Calling this on
   * resize (and before export) keeps the width correct immediately.
   */
  setResolution(width: number, height: number): void {
    this.resolution.width = Math.max(1, width);
    this.resolution.height = Math.max(1, height);
    for (const material of [
      this.outerCoreMaterial,
      this.outerHaloMaterial,
      this.innerCoreMaterial,
      this.innerHaloMaterial,
      this.cornerCoreMaterial,
      this.cornerHaloMaterial,
    ]) {
      material.resolution.set(this.resolution.width, this.resolution.height);
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /** Radius of the cell frame around the cluster origin, corner ticks excluded. */
  getBoundsRadius(): number {
    return this.boundsRadius;
  }

  /** Corner-inclusive radius, used only for diagnostics/tests. */
  getCornerBoundsRadius(): number {
    return this.cornerBoundsRadius;
  }

  /** World position of the cell anchor (the bottom A-layer atom for HCP). */
  getAnchorPosition(): [number, number, number] {
    return [this.anchor.x, this.anchor.y, this.anchor.z];
  }

  getInfo(): {
    depthTest: boolean;
    xray: boolean;
    dashed: boolean;
    opacity: number;
    lineWidth: number;
    innerLineWidth: number;
    glow: number;
    glowWidth: number;
    brightness: number;
    resolution: [number, number];
    cornerMarks: number;
    coreColor: string;
    haloColor: string;
    coreWidth: number;
    haloWidth: number;
    coreOpacity: number;
    haloOpacity: number;
    cornerOffset: number;
    cornerTick: number;
    cornerSurfaceGap: number;
    boundsRadius: number;
    cornerBoundsRadius: number;
    displayRadius: number;
    anchor: [number, number, number];
  } {
    return {
      depthTest: this.outerCoreMaterial.depthTest,
      xray: this.xray,
      dashed: this.outerCoreMaterial.dashed,
      opacity: this.outerCoreMaterial.opacity,
      lineWidth: this.lineWidth,
      innerLineWidth: Math.max(1, this.lineWidth * CORE_RATIO * INNER_RATIO),
      glow: this.outerHaloMaterial.opacity,
      glowWidth: Math.max(2.2, this.lineWidth * HALO_RATIO),
      brightness: this.brightness,
      resolution: [this.outerCoreMaterial.resolution.x, this.outerCoreMaterial.resolution.y],
      cornerMarks: this.cornerCount,
      coreColor: '#2F6B82',
      haloColor: '#D8F3FF',
      coreWidth: Math.max(1.2, this.lineWidth * CORE_RATIO),
      haloWidth: Math.max(2.2, this.lineWidth * HALO_RATIO),
      coreOpacity: this.outerCoreMaterial.opacity,
      haloOpacity: this.outerHaloMaterial.opacity,
      cornerOffset: cornerOffset(this.displayRadius),
      cornerTick: cornerTick(this.displayRadius),
      cornerSurfaceGap: cornerSurfaceGap(this.displayRadius),
      boundsRadius: this.boundsRadius,
      cornerBoundsRadius: this.cornerBoundsRadius,
      displayRadius: this.displayRadius,
      anchor: [this.anchor.x, this.anchor.y, this.anchor.z],
    };
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof LineSegments2) child.geometry.dispose();
    }
    this.cornerHalo = null;
    this.cornerCore = null;
    this.cornerCount = 0;
  }

  dispose(): void {
    this.clear();
    this.outerCoreMaterial.dispose();
    this.outerHaloMaterial.dispose();
    this.innerCoreMaterial.dispose();
    this.innerHaloMaterial.dispose();
    this.cornerCoreMaterial.dispose();
    this.cornerHaloMaterial.dispose();
  }
}
