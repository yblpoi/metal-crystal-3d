import {
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { CrystalModel, InterstitialSite, SiteType } from '../crystal/types';
import {
  isSiteVisibleInDisplay,
  siteNeighborsFullyVisible,
  siteVisibleCoordination,
  type DisplayMode,
} from '../crystal/visibility';
import type { SiteFilter } from '../state';
import { filterSites } from '../site-filter';

export const SITE_COLORS: Record<SiteType, string> = {
  O: '#FF8A5B',
  T: '#3EE6C4',
};

const SITE_GEOMETRY = new SphereGeometry(1, 24, 16);
const IDENTITY = new Quaternion();

interface SiteUpdate {
  showO: boolean;
  showT: boolean;
  filter: SiteFilter;
  selectedSiteId: string | null;
  /** Explicit user size multiplier (site size slider). */
  scale: number;
  /** Display-only atom radius multiplier; keeps sites proportional. */
  displayScale: number;
  opacity: number;
  atomVisible: boolean[];
  displayMode: DisplayMode;
  displayRange: number;
  followRange: boolean;
}

/**
 * O/T site spheres plus the coordination polyhedron of the selected site.
 * Radius never exceeds the hard-sphere geometric cap stored on each site.
 *
 * Site spheres write depth even when translucent (they are small and seldom
 * overlap), which avoids the hard silhouette / ordering artifacts that come
 * from depthWrite=false on a single InstancedMesh.
 */
export class InterstitialLayer {
  readonly group = new Group();
  private readonly materials: Record<SiteType, MeshStandardMaterial>;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly scaleVector = new Vector3();
  private readonly selectionGroup = new Group();
  private model: CrystalModel | null = null;
  private meshO: InstancedMesh | null = null;
  private meshT: InstancedMesh | null = null;
  private sitesO: InterstitialSite[] = [];
  private sitesT: InterstitialSite[] = [];
  private visibleO: InterstitialSite[] = [];
  private visibleT: InterstitialSite[] = [];
  private matrixKey = '';
  private opacity = 1;
  private selectionKey = '';
  private atomVisible: boolean[] = [];
  private selectionInfo = { hasPolyhedron: false, neighborsVisible: true };

  constructor() {
    const makeMaterial = (color: string) =>
      new MeshStandardMaterial({
        color: new Color(color),
        emissive: new Color(color),
        emissiveIntensity: 0.44,
        metalness: 0.05,
        roughness: 0.34,
        transparent: false,
        depthWrite: true,
        depthTest: true,
        toneMapped: false,
      });
    this.materials = { O: makeMaterial(SITE_COLORS.O), T: makeMaterial(SITE_COLORS.T) };
    this.group.add(this.selectionGroup);
  }

  build(model: CrystalModel): void {
    this.model = model;
    this.selectionKey = '';
    this.clearSelectionObjects();
    this.clearMeshes();
    this.sitesO = model.sites.filter((site) => site.type === 'O');
    this.sitesT = model.sites.filter((site) => site.type === 'T');
    this.visibleO = [];
    this.visibleT = [];
    this.atomVisible = [];
    this.matrixKey = '';
    this.opacity = -1;
    this.meshO = this.createMesh(this.sitesO, this.materials.O);
    this.meshT = this.createMesh(this.sitesT, this.materials.T);
    this.setSelectedSite(null, false, false);
  }

  private createMesh(sites: InterstitialSite[], material: MeshStandardMaterial): InstancedMesh {
    const mesh = new InstancedMesh(SITE_GEOMETRY, material, Math.max(1, sites.length));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 2;
    this.group.add(mesh);
    return mesh;
  }

  private clearMeshes(): void {
    if (this.meshO) {
      this.group.remove(this.meshO);
      this.meshO.dispose();
      this.meshO = null;
    }
    if (this.meshT) {
      this.group.remove(this.meshT);
      this.meshT.dispose();
      this.meshT = null;
    }
  }

  update(config: SiteUpdate): void {
    if (!this.model) return;
    this.atomVisible = config.atomVisible;
    const visibilityKey = config.atomVisible.map((value) => (value ? '1' : '0')).join('');
    const key = [
      config.showO,
      config.showT,
      config.filter,
      config.filter === 'selected' ? (config.selectedSiteId ?? '') : '',
      config.scale.toFixed(4),
      config.displayScale.toFixed(4),
      config.displayMode,
      config.displayRange.toFixed(4),
      config.followRange,
      visibilityKey,
      this.model.id,
    ].join('|');
    if (key !== this.matrixKey) {
      this.matrixKey = key;
      const keep = (site: InterstitialSite) =>
        !config.followRange ||
        isSiteVisibleInDisplay(
          site,
          this.model!,
          config.atomVisible,
          config.displayMode,
          config.displayRange,
          config.followRange,
        );
      this.visibleO = filterSites(
        this.sitesO,
        config.showO,
        config.showT,
        config.filter,
        config.selectedSiteId,
      ).filter(keep);
      this.visibleT = filterSites(
        this.sitesT,
        config.showO,
        config.showT,
        config.filter,
        config.selectedSiteId,
      ).filter(keep);
      const radiusScale = config.scale * config.displayScale;
      this.writeInstances(this.meshO, this.visibleO, radiusScale);
      this.writeInstances(this.meshT, this.visibleT, radiusScale);
    }
    if (config.opacity !== this.opacity) {
      this.opacity = config.opacity;
      const transparent = config.opacity < 0.999;
      for (const material of Object.values(this.materials)) {
        const transparencyChanged = material.transparent !== transparent;
        material.opacity = config.opacity;
        material.transparent = transparent;
        material.depthWrite = true;
        if (transparencyChanged) material.needsUpdate = true;
      }
    }
    if (this.meshO) this.meshO.visible = config.showO && this.visibleO.length > 0;
    if (this.meshT) this.meshT.visible = config.showT && this.visibleT.length > 0;
  }

  private writeInstances(
    mesh: InstancedMesh | null,
    sites: InterstitialSite[],
    scale: number,
  ): void {
    if (!mesh) return;
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      const radius = Math.max(0.0001, site.maxRadius * scale);
      this.position.set(site.position.x, site.position.y, site.position.z);
      this.scaleVector.setScalar(radius);
      this.matrix.compose(this.position, IDENTITY, this.scaleVector);
      mesh.setMatrixAt(i, this.matrix);
    }
    mesh.count = sites.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  get pickTargets(): Object3D[] {
    const targets: Object3D[] = [];
    if (this.meshO?.visible) targets.push(this.meshO);
    if (this.meshT?.visible) targets.push(this.meshT);
    return targets;
  }

  getSiteForPick(mesh: Object3D, instanceId: number): InterstitialSite | null {
    if (mesh === this.meshO) return this.visibleO[instanceId] ?? null;
    if (mesh === this.meshT) return this.visibleT[instanceId] ?? null;
    return null;
  }

  getVisibleSites(): InterstitialSite[] {
    return [...this.visibleO, ...this.visibleT];
  }

  getVisibleCounts(): { O: number; T: number; completeO: number; completeT: number } {
    let completeO = 0;
    let completeT = 0;
    for (const site of this.visibleO) {
      if (siteVisibleCoordination(site, this.atomVisible) === site.expectedCoordination) completeO++;
    }
    for (const site of this.visibleT) {
      if (siteVisibleCoordination(site, this.atomVisible) === site.expectedCoordination) completeT++;
    }
    return { O: this.visibleO.length, T: this.visibleT.length, completeO, completeT };
  }

  getSelectionInfo(): { hasPolyhedron: boolean; neighborsVisible: boolean } {
    return { ...this.selectionInfo };
  }

  getSiteMaterialInfo(): { renderOrder: number; depthWrite: boolean; opacity: number; transparent: boolean } {
    const material = this.materials.O;
    return {
      renderOrder: this.meshO?.renderOrder ?? 2,
      depthWrite: material.depthWrite,
      opacity: material.opacity,
      transparent: material.transparent,
    };
  }

  setSelectedSite(
    site: InterstitialSite | null,
    showPolyhedron: boolean,
    showBonds: boolean,
  ): void {
    const neighborsVisible = site ? siteNeighborsFullyVisible(site, this.atomVisible) : true;
    const nextKey = site
      ? `${this.model?.id ?? ''}|${site.id}|${showPolyhedron}|${showBonds}|${neighborsVisible}|${this.atomVisible.map((value) => (value ? '1' : '0')).join('')}`
      : '';
    if (nextKey === this.selectionKey) return;
    this.selectionKey = nextKey;
    this.clearSelectionObjects();
    this.selectionInfo = { hasPolyhedron: false, neighborsVisible };
    if (!site) return;

    const neighbors = site.neighborIndices
      .map((index) => this.model?.atoms[index])
      .filter((atom): atom is NonNullable<typeof atom> => Boolean(atom));
    const visibleNeighbors = neighbors.filter((atom) => this.atomVisible[atom.index] !== false);

    // Incomplete boundary sites must never get a fabricated polyhedron, and a
    // polyhedron is meaningless when part of its shell is outside the display
    // range. The site badge explains that case instead of silently drawing a
    // partial cage.
    if (showPolyhedron && site.complete && neighborsVisible && neighbors.length >= 4) {
      const points = neighbors.map(
        (atom) => new Vector3(atom.position.x, atom.position.y, atom.position.z),
      );
      const hull = new ConvexGeometry(points);
      const fill = new Mesh(
        hull,
        new MeshBasicMaterial({
          color: 0x5ce1ff,
          transparent: true,
          opacity: 0.08,
          side: DoubleSide,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      fill.renderOrder = 6;
      const hullEdges = new EdgesGeometry(hull);
      const edgeGeometry = new LineSegmentsGeometry();
      edgeGeometry.fromEdgesGeometry(hullEdges);
      hullEdges.dispose();
      const edgeMaterial = new LineMaterial({
        color: SITE_COLORS[site.type],
        transparent: true,
        opacity: 0.9,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      });
      edgeMaterial.uniforms.linewidth.value = 2.25;
      const edges = new LineSegments2(edgeGeometry, edgeMaterial);
      edges.renderOrder = 8;
      this.selectionGroup.add(fill, edges);
      this.selectionInfo.hasPolyhedron = true;
    }

    if (showBonds && visibleNeighbors.length > 0) {
      const positions: number[] = [];
      for (const atom of visibleNeighbors) {
        positions.push(site.position.x, site.position.y, site.position.z);
        positions.push(atom.position.x, atom.position.y, atom.position.z);
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      const bonds = new LineSegments(
        geometry,
        new LineBasicMaterial({
          color: 0x8fe9ff,
          transparent: true,
          opacity: 0.3,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      bonds.renderOrder = 7;
      bonds.userData.exportRole = 'bonds';
      this.selectionGroup.add(bonds);
    }
  }

  /**
   * Export wants the polyhedron (fill + hull edges) but never the UI-only
   * nearest-neighbour bonds. With includeBonds=false only those are hidden;
   * visible=false hides the whole selection group.
   */
  setSelectionVisible(visible: boolean, includeBonds = true): void {
    this.selectionGroup.visible = visible;
    for (const child of this.selectionGroup.children) {
      child.visible = child.userData.exportRole === 'bonds' ? includeBonds : true;
    }
  }

  private clearSelectionObjects(): void {
    for (const child of [...this.selectionGroup.children]) {
      this.selectionGroup.remove(child);
      if (child instanceof Mesh || child instanceof LineSegments) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      }
    }
  }

  dispose(): void {
    this.clearMeshes();
    this.clearSelectionObjects();
    for (const material of Object.values(this.materials)) material.dispose();
  }
}
