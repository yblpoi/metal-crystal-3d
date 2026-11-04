import type {
  Atom,
  CrystalModel,
  InterstitialSite,
  SiteSeed,
  SiteType,
  StructureId,
  Vec3,
} from './types';

export const EPS = 1e-9;

/** Distances (r = 1 units) of the ideal first coordination shell of each site type. */
export interface ShellSpec {
  distances: number[];
  coordination: number;
}

const FCC_A = 2 * Math.SQRT2;
const BCC_A = 4 / Math.sqrt(3);
const SQRT2 = Math.SQRT2;

/**
 * Ideal first-shell distances. Derived from the hard-sphere model, not measured:
 *   FCC O: a/2 = sqrt(2) (6x)          FCC T: sqrt(3/2) (4x)
 *   BCC O: a/2 (2x) + a/sqrt(2) (4x)   BCC T: sqrt(5/3) (4x)
 *   HCP O: sqrt(2) (6x)                HCP T: sqrt(3/2) (4x)
 */
export const SHELL_SPECS: Record<StructureId, Record<SiteType, ShellSpec>> = {
  fcc: {
    O: { distances: [SQRT2], coordination: 6 },
    T: { distances: [Math.sqrt(3 / 2)], coordination: 4 },
  },
  bcc: {
    O: { distances: [BCC_A / 2, BCC_A / SQRT2], coordination: 6 },
    T: { distances: [Math.sqrt(5 / 3)], coordination: 4 },
  },
  hcp: {
    O: { distances: [FCC_A / 2], coordination: 6 },
    T: { distances: [Math.sqrt(3 / 2)], coordination: 4 },
  },
};

export function getShellSpec(id: StructureId, type: SiteType): ShellSpec {
  return SHELL_SPECS[id][type];
}

export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** Smallest centre-to-centre distance between any two atoms. */
export function minPairDistance(atoms: Atom[]): number {
  let min = Infinity;
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const d = distance(atoms[i].position, atoms[j].position);
      if (d < min) min = d;
    }
  }
  return min;
}

/**
 * Build a fully analysed interstitial site.
 * Neighbours are all atoms within the first theoretical shell (inclusive upper
 * bound), which matters for BCC O where the shell has two distinct distances.
 */
export function analyzeSite(
  seed: SiteSeed,
  atoms: Atom[],
  spec: ShellSpec,
  theoreticalRadius: number,
): InterstitialSite {
  const cutoff = Math.max(...spec.distances) + 1e-6;
  const found: { atom: Atom; d: number }[] = [];
  let minDistance = Infinity;

  for (const atom of atoms) {
    const d = distance(seed.position, atom.position);
    if (d < minDistance) minDistance = d;
    if (d <= cutoff) found.push({ atom, d });
  }

  found.sort((a, b) => a.d - b.d);

  const min = Number.isFinite(minDistance) ? minDistance : 0;
  const geometric = Math.max(0, min - 1);

  return {
    id: seed.id,
    type: seed.type,
    position: seed.position,
    fractional: seed.fractional,
    neighborIds: found.map((n) => n.atom.id),
    neighborIndices: found.map((n) => n.atom.index),
    neighborDistances: found.map((n) => n.d),
    coordination: found.length,
    expectedCoordination: spec.coordination,
    complete: found.length === spec.coordination,
    minDistance: min,
    maxRadius: Math.min(geometric, theoreticalRadius),
    theoreticalRadius,
  };
}

export interface ValidationIssue {
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  minAtomDistance: number;
}

/**
 * Structural invariants for a finished model. Cheap enough to run in tests and
 * later in dev builds; it does not touch the DOM.
 */
export function validateCrystal(model: CrystalModel): ValidationResult {
  const issues: ValidationIssue[] = [];
  const push = (code: string, message: string) => issues.push({ code, message });

  if (model.atoms.length !== model.meta.clusterAtomCount) {
    push(
      'atom-count',
      `expected ${model.meta.clusterAtomCount} atoms, got ${model.atoms.length}`,
    );
  }

  for (const atom of model.atoms) {
    if (atom.radius !== 1) {
      push('atom-radius', `atom ${atom.id} has radius ${atom.radius}, expected 1`);
    }
    if (![atom.position.x, atom.position.y, atom.position.z].every(Number.isFinite)) {
      push('atom-position', `atom ${atom.id} has a non-finite position`);
    }
  }

  const minAtomDistance = minPairDistance(model.atoms);
  if (minAtomDistance < 2 - 1e-6) {
    push(
      'atom-overlap',
      `atoms overlap: min centre distance ${minAtomDistance.toFixed(9)} < 2 - 1e-6`,
    );
  }

  for (const site of model.sites) {
    if (!Number.isFinite(site.minDistance) || site.minDistance <= 1) {
      push(
        'site-inside-atom',
        `site ${site.id} lies inside an atom (min distance ${site.minDistance})`,
      );
    }
    if (site.coordination > site.expectedCoordination) {
      push(
        'site-overcoordinated',
        `site ${site.id} has ${site.coordination} neighbours, expected at most ${site.expectedCoordination}`,
      );
    }
    if (site.complete && site.coordination !== site.expectedCoordination) {
      push('site-complete-mismatch', `site ${site.id} marked complete but is under-coordinated`);
    }
    if (site.maxRadius > site.theoreticalRadius + 1e-9) {
      push(
        'site-radius',
        `site ${site.id} geometric radius ${site.maxRadius} exceeds theoretical ${site.theoreticalRadius}`,
      );
    }
  }

  return { ok: issues.length === 0, issues, minAtomDistance };
}
