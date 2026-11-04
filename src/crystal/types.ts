/**
 * Shared, DOM-free types for the crystallography core.
 * Everything in src/crystal must stay independent of Three.js and the browser
 * so it can be unit-tested and reused by the future 3D scene.
 */

export type StructureId = 'fcc' | 'bcc' | 'hcp';

/** Interstitial site type: octahedral or tetrahedral. */
export type SiteType = 'O' | 'T';

/** Human-facing classification of an atom inside the cluster. */
export type AtomKind = 'corner' | 'face' | 'body' | 'A' | 'B';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Atom {
  /** Stable id: structure + kind + fractional coordinate key. */
  id: string;
  /** Index inside CrystalModel.atoms, equal to the array position. */
  index: number;
  /** Cartesian position in the display frame (origin = atom nearest the bbox centre). */
  position: Vec3;
  /** Always 1 in this model (ideal hard spheres, r = 1). */
  radius: number;
  kind: AtomKind;
  /** Display label, mirrors kind ("corner", "face", "body", "A", "B"). */
  label: string;
  /** Fractional coordinate: cubic -> conventional cell units in [0,2]; HCP -> primitive i+f. */
  fractional: Vec3;
  /** HCP: stacking layer index k (0..2). Cubic: radial shell index (0 = closest to centre). */
  layer: number;
  /** Normalised distance from the cluster centre, 0..1. */
  radial: number;
}

export interface InterstitialSite {
  /** Stable id: structure + site type + deduplicated fractional coordinate key. */
  id: string;
  type: SiteType;
  /** Cartesian position in the same frame as the atoms. */
  position: Vec3;
  fractional: Vec3;
  /** Ids of the atoms forming the first coordination shell (sorted by distance). */
  neighborIds: string[];
  neighborIndices: number[];
  /** Distances to the neighbours, ascending. */
  neighborDistances: number[];
  /** Actual number of atoms found in the first shell inside the finite cluster. */
  coordination: number;
  /** 6 for O, 4 for T. */
  expectedCoordination: number;
  /** True when the cluster contains the full first shell. */
  complete: boolean;
  /** Distance to the closest atom in the cluster. */
  minDistance: number;
  /** Geometric hard-sphere radius (minDistance - 1), capped at the theoretical value. */
  maxRadius: number;
  /** Theoretical r/R ratio for this site type. */
  theoreticalRadius: number;
}

export interface LatticeInfo {
  kind: 'cubic' | 'hexagonal';
  /** Cubic: conventional lattice constant. HCP: basal lattice constant a. */
  a: number;
  /** HCP c axis, null for cubic. */
  c: number | null;
  cOverA: number | null;
  vectors: [Vec3, Vec3, Vec3];
}

export interface BasisAtom {
  label: string;
  fractional: Vec3;
}

export interface StructureMeta {
  id: StructureId;
  name: string;
  abbreviation: string;
  lattice: LatticeInfo;
  coordinationNumber: number;
  /** Atomic packing fraction of the ideal structure. */
  apf: number;
  /** Atoms in the conventional cell (cubic cell / hexagonal prism). */
  atomsPerConventionalCell: number;
  /** Atoms in the primitive cell. */
  atomsPerPrimitiveCell: number;
  /** O / T sites in the conventional cell (cubic cell / hexagonal prism). */
  octahedralPerConventionalCell: number;
  tetrahedralPerConventionalCell: number;
  /** O / T sites in the primitive cell. */
  octahedralPerPrimitiveCell: number;
  tetrahedralPerPrimitiveCell: number;
  radiusRatioOctahedral: number;
  radiusRatioTetrahedral: number;
  nearestNeighborDistance: number;
  /** Number of atoms in the finite teaching cluster. */
  clusterAtomCount: number;
  basis: BasisAtom[];
}

export interface CrystalModel {
  id: StructureId;
  atoms: Atom[];
  sites: InterstitialSite[];
  meta: StructureMeta;
  /** Max |position| over atoms, useful for framing the camera later. */
  boundingRadius: number;
  /** Always the origin: the display origin is the atom nearest the bbox centre. */
  center: Vec3;
  siteCounts: {
    O: number;
    T: number;
    completeO: number;
    completeT: number;
  };
}

/** Position + identity before neighbour analysis. */
export interface SiteSeed {
  id: string;
  type: SiteType;
  fractional: Vec3;
  position: Vec3;
}
