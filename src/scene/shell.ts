import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  Vector3,
} from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { CrystalModel } from '../crystal/types';
import type { CoordinationShell } from '../crystal/visibility';

const SHELL_COLOR = 0x8fe9ff;
const SHELL_OPACITY = 0.4;
const SHELL_WIDTH = 2.2;

type ShellShape = 'cuboctahedron' | 'anticuboctahedron' | 'cube';

interface ShellVisualInfo {
  shape: ShellShape | null;
  vertexCount: number;
  edgeCount: number;
  visible: boolean;
  opacity: number;
  lineWidth: number;
  includesCentre: boolean;
}

/**
 * First-shell coordination polyhedron that is part of the scene content.
 *
 * FCC/HCP: convex hull of the 12 nearest neighbours (cuboctahedron /
 * anticuboctahedron), thin neutral-cyan edges only. BCC: the 8 neighbours are
 * the corners of a cube, so a cube wireframe is drawn instead of a fabricated
 * 12-vertex body. The central atom is never a hull vertex; it remains visible
 * inside the frame. Hiding the polyhedron via the panel removes it from both
 * the live view and the export.
 */
export class CoordinationShellLayer {
  readonly group = new Group();
  private readonly resolution = { width: 1, height: 1 };
  private lines: LineSegments2 | null = null;
  private material: LineMaterial | null = null;
  private key = '';
  private info: ShellVisualInfo = {
    shape: null,
    vertexCount: 0,
    edgeCount: 0,
    visible: false,
    opacity: SHELL_OPACITY,
    lineWidth: SHELL_WIDTH,
    includesCentre: false,
  };

  build(model: CrystalModel): void {
    this.clear();
    this.key = `${model.id}:built`;
  }

  update(model: CrystalModel, shell: CoordinationShell, active: boolean): void {
    if (!active || shell.centerIndex < 0 || shell.neighborIndices.length === 0) {
      this.hide();
      return;
    }
    const shape: ShellShape =
      model.meta.id === 'bcc'
        ? 'cube'
        : model.meta.id === 'fcc'
          ? 'cuboctahedron'
          : 'anticuboctahedron';
    const key = `${model.id}:${shell.centerIndex}:${shape}`;
    if (key !== this.key) {
      this.rebuild(model, shell, shape);
      this.key = key;
    }
    this.group.visible = true;
    this.info.visible = true;
  }

  private rebuild(
    model: CrystalModel,
    shell: CoordinationShell,
    shape: ShellShape,
  ): void {
    this.clearLines();
    const neighbours = shell.neighborIndices
      .map((index) => model.atoms[index])
      .filter((atom): atom is NonNullable<typeof atom> => Boolean(atom));
    if (!shell.centerAtom || neighbours.length < 4) {
      this.hide();
      return;
    }

    let edgeGeometry: LineSegmentsGeometry;
    let edgeCount: number;

    if (shape === 'cube') {
      const xs = neighbours.map((atom) => atom.position.x);
      const ys = neighbours.map((atom) => atom.position.y);
      const zs = neighbours.map((atom) => atom.position.z);
      const side = Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
        Math.max(...zs) - Math.min(...zs),
      );
      const box = new BoxGeometry(side, side, side);
      box.translate(
        shell.centerAtom.position.x,
        shell.centerAtom.position.y,
        shell.centerAtom.position.z,
      );
      const edges = new EdgesGeometry(box, 1e-4);
      box.dispose();
      edgeGeometry = new LineSegmentsGeometry();
      edgeGeometry.fromEdgesGeometry(edges);
      edges.dispose();
      edgeCount = neighbours.length > 0 ? 12 : 0;
    } else {
      const points = neighbours.map(
        (atom) => new Vector3(atom.position.x, atom.position.y, atom.position.z),
      );
      const hull = new ConvexGeometry(points);
      const edges = new EdgesGeometry(hull, 1e-4);
      edgeGeometry = new LineSegmentsGeometry();
      edgeGeometry.fromEdgesGeometry(edges);
      const positions = edges.getAttribute('position');
      edgeCount = positions ? positions.count / 2 : 0;
      edges.dispose();
      hull.dispose();
    }

    this.material = new LineMaterial({
      color: SHELL_COLOR,
      transparent: true,
      opacity: SHELL_OPACITY,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.material.uniforms.linewidth.value = SHELL_WIDTH;
    this.material.resolution.set(this.resolution.width, this.resolution.height);
    this.lines = new LineSegments2(edgeGeometry, this.material);
    this.lines.renderOrder = 5;
    this.lines.frustumCulled = false;
    this.group.add(this.lines);

    this.info = {
      shape,
      vertexCount: neighbours.length,
      edgeCount,
      visible: true,
      opacity: SHELL_OPACITY,
      lineWidth: SHELL_WIDTH,
      includesCentre: false,
    };
  }

  setResolution(width: number, height: number): void {
    this.resolution.width = Math.max(1, width);
    this.resolution.height = Math.max(1, height);
    this.material?.resolution.set(this.resolution.width, this.resolution.height);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.info.visible = visible && this.lines !== null;
  }

  hide(): void {
    this.group.visible = false;
    this.info.visible = false;
  }

  getInfo(): ShellVisualInfo {
    return { ...this.info };
  }

  private clearLines(): void {
    if (!this.lines) return;
    this.group.remove(this.lines);
    this.lines.geometry.dispose();
    this.material?.dispose();
    this.lines = null;
    this.material = null;
  }

  private clear(): void {
    this.clearLines();
    this.key = '';
    this.info = {
      shape: null,
      vertexCount: 0,
      edgeCount: 0,
      visible: false,
      opacity: SHELL_OPACITY,
      lineWidth: SHELL_WIDTH,
      includesCentre: false,
    };
  }

  dispose(): void {
    this.clear();
  }
}
