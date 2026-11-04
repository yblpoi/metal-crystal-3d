import type {
  Atom,
  AtomKind,
  BasisAtom,
  CrystalModel,
  SiteSeed,
  SiteType,
  StructureId,
  StructureMeta,
  Vec3,
} from './types';
import { analyzeSite, getShellSpec, length } from './neighbors';

/**
 * Ideal hard-sphere model, normalised so that r = 1 and the nearest-neighbour
 * centre distance is 2. Every atom radius is exactly 1.
 */
export const ATOM_RADIUS = 1;
export const NEAREST_NEIGHBOR_DISTANCE = 2;

const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);

export const FCC_A = 2 * SQRT2; // 2.8284271247461903
export const BCC_A = 4 / SQRT3; // 2.3094010767585034
export const HCP_A = 2;
export const HCP_C_OVER_A = Math.sqrt(8 / 3); // 1.632993161855452
export const HCP_C = HCP_A * HCP_C_OVER_A; // 3.265986323710904

export const FCC_OCTAHEDRAL_RATIO = SQRT2 - 1; // 0.41421356237309515
export const FCC_TETRAHEDRAL_RATIO = Math.sqrt(3 / 2) - 1; // 0.22474487139158894
export const BCC_OCTAHEDRAL_RATIO = 2 / SQRT3 - 1; // 0.15470053837925168
export const BCC_TETRAHEDRAL_RATIO = Math.sqrt(5 / 3) - 1; // 0.2909944487358056

const FCC_BASIS: BasisAtom[] = [
  { label: 'corner', fractional: { x: 0, y: 0, z: 0 } },
  { label: 'face', fractional: { x: 0.5, y: 0.5, z: 0 } },
  { label: 'face', fractional: { x: 0.5, y: 0, z: 0.5 } },
  { label: 'face', fractional: { x: 0, y: 0.5, z: 0.5 } },
];

const BCC_BASIS: BasisAtom[] = [
  { label: 'corner', fractional: { x: 0, y: 0, z: 0 } },
  { label: 'body', fractional: { x: 0.5, y: 0.5, z: 0.5 } },
];

const HCP_BASIS: BasisAtom[] = [
  { label: 'A', fractional: { x: 0, y: 0, z: 0 } },
  { label: 'B', fractional: { x: 1 / 3, y: 2 / 3, z: 0.5 } },
];

/** a1 = (a,0,0), a2 = (-a/2, sqrt(3)a/2, 0), c = (0,0,c). */
export const HCP_LATTICE_VECTORS = {
  a1: { x: HCP_A, y: 0, z: 0 } as Vec3,
  a2: { x: -HCP_A / 2, y: (SQRT3 * HCP_A) / 2, z: 0 } as Vec3,
  c: { x: 0, y: 0, z: HCP_C } as Vec3,
};

const CUBIC_VECTORS = (a: number): [Vec3, Vec3, Vec3] => [
  { x: a, y: 0, z: 0 },
  { x: 0, y: a, z: 0 },
  { x: 0, y: 0, z: a },
];

export const STRUCTURE_META: Record<StructureId, StructureMeta> = {
  fcc: {
    id: 'fcc',
    name: '面心立方最密堆积',
    abbreviation: 'FCC',
    lattice: {
      kind: 'cubic',
      a: FCC_A,
      c: null,
      cOverA: null,
      vectors: CUBIC_VECTORS(FCC_A),
    },
    coordinationNumber: 12,
    apf: Math.PI / (3 * SQRT2),
    atomsPerConventionalCell: 4,
    atomsPerPrimitiveCell: 1,
    octahedralPerConventionalCell: 4,
    tetrahedralPerConventionalCell: 8,
    octahedralPerPrimitiveCell: 1,
    tetrahedralPerPrimitiveCell: 2,
    radiusRatioOctahedral: FCC_OCTAHEDRAL_RATIO,
    radiusRatioTetrahedral: FCC_TETRAHEDRAL_RATIO,
    nearestNeighborDistance: NEAREST_NEIGHBOR_DISTANCE,
    clusterAtomCount: 63,
    basis: FCC_BASIS,
  },
  bcc: {
    id: 'bcc',
    name: '体心立方堆积',
    abbreviation: 'BCC',
    lattice: {
      kind: 'cubic',
      a: BCC_A,
      c: null,
      cOverA: null,
      vectors: CUBIC_VECTORS(BCC_A),
    },
    coordinationNumber: 8,
    apf: (Math.PI * SQRT3) / 8,
    atomsPerConventionalCell: 2,
    atomsPerPrimitiveCell: 1,
    octahedralPerConventionalCell: 6,
    tetrahedralPerConventionalCell: 12,
    octahedralPerPrimitiveCell: 3,
    tetrahedralPerPrimitiveCell: 6,
    radiusRatioOctahedral: BCC_OCTAHEDRAL_RATIO,
    radiusRatioTetrahedral: BCC_TETRAHEDRAL_RATIO,
    nearestNeighborDistance: NEAREST_NEIGHBOR_DISTANCE,
    clusterAtomCount: 35,
    basis: BCC_BASIS,
  },
  hcp: {
    id: 'hcp',
    name: '六方最密堆积',
    abbreviation: 'HCP',
    lattice: {
      kind: 'hexagonal',
      a: HCP_A,
      c: HCP_C,
      cOverA: HCP_C_OVER_A,
      vectors: [HCP_LATTICE_VECTORS.a1, HCP_LATTICE_VECTORS.a2, HCP_LATTICE_VECTORS.c],
    },
    coordinationNumber: 12,
    apf: Math.PI / (3 * SQRT2),
    atomsPerConventionalCell: 6, // hexagonal prism
    atomsPerPrimitiveCell: 2,
    octahedralPerConventionalCell: 6, // hexagonal prism
    tetrahedralPerConventionalCell: 12, // hexagonal prism
    octahedralPerPrimitiveCell: 2,
    tetrahedralPerPrimitiveCell: 4,
    radiusRatioOctahedral: FCC_OCTAHEDRAL_RATIO,
    radiusRatioTetrahedral: FCC_TETRAHEDRAL_RATIO,
    nearestNeighborDistance: NEAREST_NEIGHBOR_DISTANCE,
    clusterAtomCount: 57,
    basis: HCP_BASIS,
  },
};

export function getStructureMeta(id: StructureId): StructureMeta {
  return STRUCTURE_META[id];
}

/* ------------------------------------------------------------------ */
/* utilities                                                           */
/* ------------------------------------------------------------------ */

/** Stable 6-decimal key, used for dedupe and ids (never for maths). */
function fracKey(n: number): string {
  const rounded = Math.round(n * 1e6) / 1e6;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(6);
}

/** Round away float noise, then wrap into [0, period). */
function wrapFraction(value: number, period: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  const wrapped = ((rounded % period) + period) % period;
  return Math.round(wrapped * 1e6) / 1e6;
}

interface RawAtom {
  kind: AtomKind;
  fractional: Vec3;
  position: Vec3;
}

function vecKey(f: Vec3): string {
  return `${fracKey(f.x)},${fracKey(f.y)},${fracKey(f.z)}`;
}

/** Adds index / stable id / shell layer / normalised radius. */
function finalizeAtoms(id: StructureId, raws: RawAtom[]): Atom[] {
  const distances = raws.map((raw) => length(raw.position));
  const maxDistance = Math.max(...distances, 1e-12);

  const shells =
    id === 'hcp'
      ? null
      : [...new Set(distances.map((d) => Math.round(d * 1e6) / 1e6))].sort((a, b) => a - b);

  return raws.map((raw, index) => {
    const d = distances[index];
    const layer =
      shells === null
        ? Math.round(raw.fractional.z * 2) // HCP stacking layer k = 0,1,2
        : shells.indexOf(Math.round(d * 1e6) / 1e6);

    return {
      id: `${id}:${raw.kind}:${vecKey(raw.fractional)}`,
      index,
      position: raw.position,
      radius: ATOM_RADIUS,
      kind: raw.kind,
      label: raw.kind,
      fractional: raw.fractional,
      layer,
      radial: d / maxDistance,
    };
  });
}

/* ------------------------------------------------------------------ */
/* atoms                                                               */
/* ------------------------------------------------------------------ */

/**
 * FCC, N = 2 conventional cells.
 * Half-lattice integer coordinates (p,q,r) in [0,4], p+q+r even -> 63 sites.
 * Exactly-two-odd half-coordinates = face centres, all-even = corners.
 */
function buildFccAtoms(): Atom[] {
  const a = FCC_A;
  const step = a / 2;
  const shift = a; // centre of [0, 2a]^3
  const raws: RawAtom[] = [];

  for (let p = 0; p <= 4; p++) {
    for (let q = 0; q <= 4; q++) {
      for (let r = 0; r <= 4; r++) {
        if ((p + q + r) % 2 !== 0) continue;
        const isCorner = p % 2 === 0 && q % 2 === 0 && r % 2 === 0;
        raws.push({
          kind: isCorner ? 'corner' : 'face',
          fractional: { x: p / 2, y: q / 2, z: r / 2 },
          position: {
            x: p * step - shift,
            y: q * step - shift,
            z: r * step - shift,
          },
        });
      }
    }
  }

  return finalizeAtoms('fcc', raws);
}

/**
 * BCC, N = 2 conventional cells.
 * 3^3 = 27 corner sites + 2^3 = 8 body centres = 35 atoms.
 */
function buildBccAtoms(): Atom[] {
  const a = BCC_A;
  const shift = a;
  const raws: RawAtom[] = [];

  for (let i = 0; i <= 2; i++) {
    for (let j = 0; j <= 2; j++) {
      for (let k = 0; k <= 2; k++) {
        raws.push({
          kind: 'corner',
          fractional: { x: i, y: j, z: k },
          position: { x: i * a - shift, y: j * a - shift, z: k * a - shift },
        });
      }
    }
  }

  for (let i = 0; i <= 1; i++) {
    for (let j = 0; j <= 1; j++) {
      for (let k = 0; k <= 1; k++) {
        raws.push({
          kind: 'body',
          fractional: { x: i + 0.5, y: j + 0.5, z: k + 0.5 },
          position: {
            x: (i + 0.5) * a - shift,
            y: (j + 0.5) * a - shift,
            z: (k + 0.5) * a - shift,
          },
        });
      }
    }
  }

  return finalizeAtoms('bcc', raws);
}

/** Axis-aligned bounding-box centre of a set of raw atoms. */
function bboxCenter(raws: RawAtom[]): Vec3 {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const { position } of raws) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    minZ = Math.min(minZ, position.z);
    maxX = Math.max(maxX, position.x);
    maxY = Math.max(maxY, position.y);
    maxZ = Math.max(maxZ, position.z);
  }

  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
}

/**
 * HCP, 3 layers A-B-A of 19 atoms each = 57.
 * Layer k sits at z = k*c/2 (A: even k, B: odd k with the (1/3,2/3) offset).
 * Region per layer: i,j in [-2,2] and |i - j| <= 2, i.e.
 * max(|i|, |j|, |i - j|) <= 2. With a1 = (a,0) and a2 = (-a/2, sqrt(3)a/2)
 * this is the regular hexagon of side 2a: six equal edges, six vertices at
 * radius 2a. Using |i + j| instead would produce an elongated hexagon with
 * alternating edge lengths 2a and 2*sqrt(3)a.
 * Generated in the crystal frame; the cluster is centred on its bounding box
 * afterwards (the B-layer offset makes the bbox centre differ from the
 * hexagonal axis, which is expected).
 */
function buildHcpRawAtoms(): RawAtom[] {
  const { a1, a2 } = HCP_LATTICE_VECTORS;
  const raws: RawAtom[] = [];

  for (let k = 0; k <= 2; k++) {
    const isB = k % 2 === 1;
    const du = isB ? 1 / 3 : 0;
    const dv = isB ? 2 / 3 : 0;
    const z = (k * HCP_C) / 2;

    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        if (Math.abs(i - j) > 2) continue;
        const u = i + du;
        const v = j + dv;
        raws.push({
          kind: isB ? 'B' : 'A',
          fractional: { x: u, y: v, z: k / 2 },
          position: {
            x: a1.x * u + a2.x * v,
            y: a1.y * u + a2.y * v,
            z,
          },
        });
      }
    }
  }

  return raws;
}

/**
 * The atom closest to the bounding-box centre becomes the display origin.
 *
 * FCC/BCC already have an atom at their bbox centre, so this is a no-op there.
 * HCP does not: with A-B-A layers the bbox centre falls halfway between the
 * central B atom and the A column, and centring on the bbox would leave the
 * CN-12 atom at (0, 0.577, 0). Using that atom as the origin makes the radial
 * display filter symmetric (1 + 12 + 6 = 19 at range 0.62) instead of the old
 * 5/8/5 slice. This is a display translation only: fractional coordinates and
 * nearest-neighbour distances are untouched.
 */
function nearestToBboxCentre(raws: RawAtom[]): RawAtom {
  const centre = bboxCenter(raws);
  let best = raws[0];
  let bestDistance = Infinity;
  for (const raw of raws) {
    const distance = Math.hypot(
      raw.position.x - centre.x,
      raw.position.y - centre.y,
      raw.position.z - centre.z,
    );
    if (distance < bestDistance - 1e-12) {
      best = raw;
      bestDistance = distance;
    }
  }
  return best;
}

/** Translation applied to the whole HCP cluster (atoms and interstitial sites). */
function hcpClusterShift(): Vec3 {
  return nearestToBboxCentre(buildHcpRawAtoms()).position;
}

function buildHcpAtoms(): Atom[] {
  const raws = buildHcpRawAtoms();
  const shift = hcpClusterShift();
  return finalizeAtoms(
    'hcp',
    raws.map((raw) => ({
      ...raw,
      position: {
        x: raw.position.x - shift.x,
        y: raw.position.y - shift.y,
        z: raw.position.z - shift.z,
      },
    })),
  );
}

/* ------------------------------------------------------------------ */
/* interstitial site bases                                             */
/* ------------------------------------------------------------------ */

/** FCC: 1 body centre + 12 edge midpoints; 8 tetrahedral (1/4|3/4)^3. */
function fccSiteBasis(): SiteSeed[] {
  const out: SiteSeed[] = [];
  const push = (type: SiteType, x: number, y: number, z: number) =>
    out.push({ id: '', type, fractional: { x, y, z }, position: { x: 0, y: 0, z: 0 } });

  push('O', 0.5, 0.5, 0.5);
  for (const axis of [0, 1, 2] as const) {
    const others = [0, 1, 2].filter((v) => v !== axis);
    for (const s1 of [0, 1]) {
      for (const s2 of [0, 1]) {
        const f = [0, 0, 0];
        f[axis] = 0.5;
        f[others[0]] = s1;
        f[others[1]] = s2;
        push('O', f[0], f[1], f[2]);
      }
    }
  }

  for (const x of [0.25, 0.75]) {
    for (const y of [0.25, 0.75]) {
      for (const z of [0.25, 0.75]) {
        push('T', x, y, z);
      }
    }
  }

  return out;
}

/**
 * BCC: 6 face centres + 12 edge midpoints (octahedral, flattened);
 * tetrahedral: 4 positions on each of the 6 faces -> 24 per cell, 12 net.
 */
function bccSiteBasis(): SiteSeed[] {
  const out: SiteSeed[] = [];
  const push = (type: SiteType, x: number, y: number, z: number) =>
    out.push({ id: '', type, fractional: { x, y, z }, position: { x: 0, y: 0, z: 0 } });

  for (const axis of [0, 1, 2] as const) {
    const others = [0, 1, 2].filter((v) => v !== axis);
    for (const side of [0, 1]) {
      const face = [0.5, 0.5, 0.5];
      face[axis] = side;
      push('O', face[0], face[1], face[2]);

      const pairs: [number, number][] = [
        [0.25, 0.5],
        [0.75, 0.5],
        [0.5, 0.25],
        [0.5, 0.75],
      ];
      for (const [u, v] of pairs) {
        const p = [0, 0, 0];
        p[axis] = side;
        p[others[0]] = u;
        p[others[1]] = v;
        push('T', p[0], p[1], p[2]);
      }
    }
  }

  // 12 edge midpoints
  for (const axis of [0, 1, 2] as const) {
    const others = [0, 1, 2].filter((v) => v !== axis);
    for (const s1 of [0, 1]) {
      for (const s2 of [0, 1]) {
        const f = [0, 0, 0];
        f[axis] = 0.5;
        f[others[0]] = s1;
        f[others[1]] = s2;
        push('O', f[0], f[1], f[2]);
      }
    }
  }

  return out;
}

function cubicSiteBasis(id: 'fcc' | 'bcc'): SiteSeed[] {
  return id === 'fcc' ? fccSiteBasis() : bccSiteBasis();
}

/**
 * HCP interstitial bases in primitive fractional coordinates.
 * These are the given, numerically verified coordinates and must not be
 * re-derived from a different origin.
 */
const HCP_SITE_BASIS: { type: SiteType; fractional: Vec3 }[] = [
  { type: 'O', fractional: { x: 2 / 3, y: 1 / 3, z: 0.25 } },
  { type: 'O', fractional: { x: 2 / 3, y: 1 / 3, z: 0.75 } },
  { type: 'T', fractional: { x: 0, y: 0, z: 3 / 8 } },
  { type: 'T', fractional: { x: 0, y: 0, z: 5 / 8 } },
  { type: 'T', fractional: { x: 1 / 3, y: 2 / 3, z: 1 / 8 } },
  { type: 'T', fractional: { x: 1 / 3, y: 2 / 3, z: 7 / 8 } },
];

/* ------------------------------------------------------------------ */
/* interstitial site enumeration                                       */
/* ------------------------------------------------------------------ */

/**
 * Enumerate lattice sites of one or more cubic conventional cells, folding
 * periodic images with a fractional-coordinate key. cells = 1 gives the true
 * per-cell counts (FCC 4 O / 8 T, BCC 6 O / 12 T).
 */
function buildCubicSites(id: 'fcc' | 'bcc', cells: number): SiteSeed[] {
  const a = STRUCTURE_META[id].lattice.a;
  const basis = cubicSiteBasis(id);
  const map = new Map<string, SiteSeed>();
  const half = (cells * a) / 2;

  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      for (let k = 0; k < cells; k++) {
        for (const b of basis) {
          const fx = wrapFraction(b.fractional.x + i, cells);
          const fy = wrapFraction(b.fractional.y + j, cells);
          const fz = wrapFraction(b.fractional.z + k, cells);
          const key = `${b.type}|${fracKey(fx)},${fracKey(fy)},${fracKey(fz)}`;
          if (map.has(key)) continue;
          map.set(key, {
            id: `${id}:${b.type}:${fracKey(fx)},${fracKey(fy)},${fracKey(fz)}`,
            type: b.type,
            fractional: { x: fx, y: fy, z: fz },
            position: { x: fx * a - half, y: fy * a - half, z: fz * a - half },
          });
        }
      }
    }
  }

  return [...map.values()];
}

/**
 * HCP sites: primitive translations i,j in [-3,3], k in [-1,3], filtered to the
 * same regular hexagonal region as the atoms (|u|,|v|,|u-v| <= 2, with u/v the
 * fractional lattice coordinates including the site offset) and the 3 atom
 * layers (0 <= z/c <= 1), then deduplicated by fractional key.
 */
function buildHcpSites(): SiteSeed[] {
  const { a1, a2 } = HCP_LATTICE_VECTORS;
  // Same translation as the atoms: a site must not drift relative to its
  // surrounding cluster when the display origin changes.
  const shift = hcpClusterShift();
  const map = new Map<string, SiteSeed>();

  for (let k = -1; k <= 3; k++) {
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        for (const b of HCP_SITE_BASIS) {
          const u = i + b.fractional.x;
          const v = j + b.fractional.y;
          const w = k + b.fractional.z;

          if (Math.abs(u) > 2 + 1e-9) continue;
          if (Math.abs(v) > 2 + 1e-9) continue;
          if (Math.abs(u - v) > 2 + 1e-9) continue;
          if (w < -1e-9 || w > 1 + 1e-9) continue;

          const key = `${b.type}|${fracKey(u)},${fracKey(v)},${fracKey(w)}`;
          if (map.has(key)) continue;

          map.set(key, {
            id: `hcp:${b.type}:${fracKey(u)},${fracKey(v)},${fracKey(w)}`,
            type: b.type,
            fractional: { x: u, y: v, z: w },
            position: {
              x: a1.x * u + a2.x * v - shift.x,
              y: a1.y * u + a2.y * v - shift.y,
              z: w * HCP_C - shift.z,
            },
          });
        }
      }
    }
  }

  return [...map.values()];
}

/**
 * Periodic per-cell site counts, used by tests to verify 4/4/8, 2/6/12 and
 * the HCP primitive 2/2/4. The hexagonal prism holds 3 primitive cells.
 */
export function enumerateCellSites(id: StructureId, cells = 1): { O: number; T: number } {
  if (id !== 'hcp') {
    const seeds = buildCubicSites(id, cells);
    return {
      O: seeds.filter((s) => s.type === 'O').length,
      T: seeds.filter((s) => s.type === 'T').length,
    };
  }

  const map = new Map<string, SiteSeed>();
  for (const b of HCP_SITE_BASIS) {
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        const u = wrapFraction(i + b.fractional.x, cells);
        const v = wrapFraction(j + b.fractional.y, cells);
        const w = wrapFraction(b.fractional.z, 1);
        const key = `${b.type}|${fracKey(u)},${fracKey(v)},${fracKey(w)}`;
        if (map.has(key)) continue;
        map.set(key, {
          id: key,
          type: b.type,
          fractional: { x: u, y: v, z: w },
          position: { x: 0, y: 0, z: 0 },
        });
      }
    }
  }
  const seeds = [...map.values()];
  return {
    O: seeds.filter((s) => s.type === 'O').length,
    T: seeds.filter((s) => s.type === 'T').length,
  };
}

/* ------------------------------------------------------------------ */
/* public builder                                                      */
/* ------------------------------------------------------------------ */

function buildAtoms(id: StructureId): Atom[] {
  switch (id) {
    case 'fcc':
      return buildFccAtoms();
    case 'bcc':
      return buildBccAtoms();
    case 'hcp':
      return buildHcpAtoms();
    default: {
      const never: never = id;
      throw new Error(`unknown structure: ${String(never)}`);
    }
  }
}

function buildSiteSeeds(id: StructureId): SiteSeed[] {
  return id === 'hcp' ? buildHcpSites() : buildCubicSites(id, 2);
}

export function buildCrystal(id: StructureId): CrystalModel {
  const meta = STRUCTURE_META[id];
  const atoms = buildAtoms(id);
  const seeds = buildSiteSeeds(id);

  const sites = seeds.map((seed) => {
    const spec = getShellSpec(id, seed.type);
    const theoretical =
      seed.type === 'O' ? meta.radiusRatioOctahedral : meta.radiusRatioTetrahedral;
    return analyzeSite(seed, atoms, spec, theoretical);
  });

  const boundingRadius = atoms.reduce((max, atom) => Math.max(max, length(atom.position)), 0);

  return {
    id,
    atoms,
    sites,
    meta,
    boundingRadius,
    center: { x: 0, y: 0, z: 0 },
    siteCounts: {
      O: sites.filter((s) => s.type === 'O').length,
      T: sites.filter((s) => s.type === 'T').length,
      completeO: sites.filter((s) => s.type === 'O' && s.complete).length,
      completeT: sites.filter((s) => s.type === 'T' && s.complete).length,
    },
  };
}
