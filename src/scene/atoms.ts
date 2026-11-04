import {
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshPhysicalMaterial,
  NormalBlending,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';
import type { Atom, CrystalModel } from '../crystal/types';

/** One shared unit sphere for every structure and every rebuild. */
const ATOM_GEOMETRY = new SphereGeometry(1, 48, 32);

/** Ring stroke widths are in texture texels. The sprite covers ~2.5 world units. */
function createRingTexture(accent: string, lineWidth: number): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const centre = size / 2;
  const radius = size * 0.415;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = accent;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Four short ticks: a target reticle, not a cage or three orthogonal rings.
  ctx.lineWidth = lineWidth * 0.8;
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(centre + Math.cos(angle) * radius * 0.84, centre + Math.sin(angle) * radius * 0.84);
    ctx.lineTo(centre + Math.cos(angle) * radius * 1.09, centre + Math.sin(angle) * radius * 1.09);
    ctx.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Instanced hard spheres with two parallel layers:
 *
 * - a solid metal layer for interactive atoms;
 * - an atom-xray ghost layer for atoms outside the display range (the
 *   "被隐藏的球体使用原子透视" requirement) and for the global atom-xray mode.
 *
 * Both layers keep one slot per Atom, so colours never shift when the display
 * range changes. The underlying crystallographic radius is always r = 1; the
 * instance scale is a display-only factor (global display radius × per-atom
 * size), which keeps the data untouched.
 *
 * Selection is a pool of screen-aligned target rings (one per selected atom),
 * not polyhedral cages: a cuboctahedron would be the correct CN-12 shape and
 * any hand-built cage would misrepresent the local coordination.
 */
export class AtomLayer {
  readonly group = new Group();
  private readonly metalMaterial: MeshPhysicalMaterial;
  private readonly ghostMaterial: ShaderMaterial;
  private readonly selectionMaterial: SpriteMaterial;
  private readonly hoverSprite: Sprite;
  private readonly shellSprite: Sprite;
  private readonly selectionSprites: Sprite[] = [];
  private readonly selectedTexture: CanvasTexture;
  private readonly hoverTexture: CanvasTexture;
  private readonly color = new Color();
  private readonly matrix = new Matrix4();
  private solidMesh: InstancedMesh | null = null;
  private ghostMesh: InstancedMesh | null = null;
  private atoms: Atom[] = [];
  private solid: boolean[] = [];
  private xray: boolean[] = [];
  private sizes: number[] = [];
  private displayRadius = 1;
  private shellCenterIndex: number | null = null;
  private selectionIndices: number[] = [];
  private colorKey = '';
  private exportMode = false;
  private exportSelectionWasVisible: boolean[] = [];
  private exportShellWasVisible = false;

  constructor() {
    this.metalMaterial = new MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.85,
      roughness: 0.32,
      clearcoat: 0.14,
      clearcoatRoughness: 0.4,
      envMapIntensity: 1.0,
    });
    // NormalBlending + Fresnel rim. No additive accumulation, so overlapping
    // ghosts do not wash the interstitial colours out.
    this.ghostMaterial = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(0x8fb2c2) },
        uRim: { value: new Color(0xc9e6f0) },
        uOpacity: { value: 0.09 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          #ifdef USE_INSTANCING
            mat4 instance = instanceMatrix;
          #else
            mat4 instance = mat4(1.0);
          #endif
          vec4 mvPosition = modelViewMatrix * instance * vec4(position, 1.0);
          vNormalView = normalize(mat3(modelViewMatrix) * mat3(instance) * normal);
          vViewDir = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        uniform vec3 uColor;
        uniform vec3 uRim;
        uniform float uOpacity;
        void main() {
          float facing = clamp(dot(normalize(vNormalView), normalize(vViewDir)), 0.0, 1.0);
          float fresnel = pow(1.0 - facing, 3.0);
          vec3 color = mix(uColor, uRim, fresnel);
          float alpha = uOpacity + fresnel * 0.16;
          gl_FragColor = vec4(color, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: NormalBlending,
      side: 0,
    });

    this.selectedTexture = createRingTexture('rgba(150, 244, 255, 0.98)', 9.5);
    this.hoverTexture = createRingTexture('rgba(196, 239, 250, 0.72)', 7.5);
    this.selectionMaterial = new SpriteMaterial({
      map: this.selectedTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.hoverSprite = new Sprite(
      new SpriteMaterial({
        map: this.hoverTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        opacity: 0.55,
      }),
    );
    this.shellSprite = new Sprite(
      new SpriteMaterial({
        map: this.selectedTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        opacity: 0.78,
      }),
    );
    this.hoverSprite.scale.setScalar(2.12);
    this.shellSprite.scale.setScalar(2.4);
    this.hoverSprite.renderOrder = 6;
    this.shellSprite.renderOrder = 6;
    this.hoverSprite.visible = false;
    this.shellSprite.visible = false;
    this.group.add(this.hoverSprite, this.shellSprite);
  }

  build(model: CrystalModel): void {
    this.atoms = model.atoms;
    this.colorKey = '';
    this.solid = this.atoms.map(() => true);
    this.xray = this.atoms.map(() => false);
    this.sizes = this.atoms.map(() => 1);

    const solidMesh = this.createMesh(this.metalMaterial, 0);
    const ghostMesh = this.createMesh(this.ghostMaterial, 3);
    this.replaceMeshes(solidMesh, ghostMesh);
    this.writeMatrices();
    this.setSelection([]);
    this.setHover(null);
    this.setShellCenter(null);
  }

  private createMesh(material: MeshPhysicalMaterial | ShaderMaterial, order: number): InstancedMesh {
    const mesh = new InstancedMesh(ATOM_GEOMETRY, material, this.atoms.length);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    return mesh;
  }

  /**
   * Display-only update. `solid` atoms render with the metal material; `xray`
   * atoms render with the transparent atom-xray material. Both arrays are
   * indexed exactly like CrystalModel.atoms.
   */
  setDisplay(
    solid: boolean[],
    xray: boolean[],
    radius: number,
    sizes: number[] = [],
  ): void {
    if (solid.length !== this.atoms.length || xray.length !== this.atoms.length) return;
    this.solid = solid.slice();
    this.xray = xray.slice();
    this.sizes =
      sizes.length === this.atoms.length ? sizes.slice() : this.atoms.map(() => 1);
    this.displayRadius = Math.min(1, Math.max(0.5, radius));
    this.writeMatrices();
    this.syncSelectionSprites();
    this.updateHoverVisibility();
    this.updateShellVisibility();
  }

  private atomScale(index: number): number {
    const multiplier = this.sizes[index] ?? 1;
    return this.displayRadius * Math.min(1.6, Math.max(0.4, multiplier));
  }

  private writeMatrices(): void {
    const solidMesh = this.solidMesh;
    const ghostMesh = this.ghostMesh;
    if (!solidMesh || !ghostMesh) return;
    for (let i = 0; i < this.atoms.length; i++) {
      const atom = this.atoms[i];
      const scale = this.atomScale(i);
      const solidScale = this.solid[i] ? scale : 0;
      const ghostScale = this.xray[i] ? scale : 0;
      this.matrix.makeScale(solidScale, solidScale, solidScale);
      this.matrix.setPosition(atom.position.x, atom.position.y, atom.position.z);
      solidMesh.setMatrixAt(i, this.matrix);
      this.matrix.makeScale(ghostScale, ghostScale, ghostScale);
      this.matrix.setPosition(atom.position.x, atom.position.y, atom.position.z);
      ghostMesh.setMatrixAt(i, this.matrix);
    }
    solidMesh.instanceMatrix.needsUpdate = true;
    ghostMesh.instanceMatrix.needsUpdate = true;
    solidMesh.count = this.atoms.length;
    ghostMesh.count = this.atoms.length;
  }

  private setRingScale(sprite: Sprite, index: number, base: number): void {
    sprite.scale.setScalar(base * this.atomScale(index));
  }

  /**
   * Cyan target ring for the coordination-shell centre. UI-only feedback: it
   * is hidden while exporting, while the coordination polyhedron next to it is
   * content and stays in the file.
   */
  setShellCenter(index: number | null): void {
    this.shellCenterIndex = index;
    this.updateShellVisibility();
  }

  private updateShellVisibility(): void {
    const index = this.shellCenterIndex;
    const atom = index === null ? null : this.atoms[index];
    if (
      !atom ||
      !(this.solid[index!] || this.xray[index!]) ||
      this.exportMode
    ) {
      this.shellSprite.visible = false;
      return;
    }
    this.shellSprite.position.set(atom.position.x, atom.position.y, atom.position.z);
    this.setRingScale(this.shellSprite, index!, 2.4);
    this.shellSprite.visible = true;
  }

  getShellRingInfo(): { visible: boolean; index: number | null; scale: number } {
    return {
      visible: this.shellSprite.visible,
      index: this.shellCenterIndex,
      scale: this.shellSprite.scale.x,
    };
  }

  /** Solid, interactive atom (kept for the existing debug/acceptance API). */
  isVisibleIndex(index: number): boolean {
    return this.solid[index] === true;
  }

  /** Rendered either solid or as an atom-xray ghost. */
  isRenderedIndex(index: number): boolean {
    return this.solid[index] === true || this.xray[index] === true;
  }

  getVisibleCount(): number {
    let count = 0;
    for (const value of this.solid) if (value) count++;
    return count;
  }

  getXrayCount(): number {
    let count = 0;
    for (const value of this.xray) if (value) count++;
    return count;
  }

  getDisplayRadius(): number {
    return this.displayRadius;
  }

  getDisplaySize(index: number): number {
    return this.atomScale(index);
  }

  private replaceMeshes(solidMesh: InstancedMesh, ghostMesh: InstancedMesh): void {
    if (this.solidMesh) {
      this.group.remove(this.solidMesh);
      this.solidMesh.dispose();
    }
    if (this.ghostMesh) {
      this.group.remove(this.ghostMesh);
      this.ghostMesh.dispose();
    }
    this.solidMesh = solidMesh;
    this.ghostMesh = ghostMesh;
    this.group.add(solidMesh, ghostMesh);
  }

  /** Pick targets, solid layer first so solid atoms win tie hits. */
  get pickTargets(): InstancedMesh[] {
    const targets: InstancedMesh[] = [];
    if (this.solidMesh) targets.push(this.solidMesh);
    if (this.ghostMesh) targets.push(this.ghostMesh);
    return targets;
  }

  get instancedMesh(): InstancedMesh | null {
    return this.solidMesh;
  }

  get atomCount(): number {
    return this.atoms.length;
  }

  setColors(colors: string[]): void {
    const mesh = this.solidMesh;
    if (!mesh || colors.length !== this.atoms.length) return;
    const key = colors.join('|');
    if (key === this.colorKey) return;
    this.colorKey = key;
    for (let i = 0; i < colors.length; i++) {
      this.color.set(colors[i]);
      mesh.setColorAt(i, this.color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    if (this.solidMesh) this.solidMesh.visible = visible;
    if (this.ghostMesh) this.ghostMesh.visible = visible;
  }

  /** Single-atom selection shim; the UI uses setSelection for multi-select. */
  setSelected(index: number | null): void {
    this.setSelection(index === null ? [] : [index]);
  }

  /** Logical multi-selection; rings show for every selected atom still rendered. */
  setSelection(indices: number[]): void {
    this.selectionIndices = indices.slice();
    this.syncSelectionSprites();
  }

  /** Positions one target ring per rendered selected atom (solid or atom-xray). */
  private syncSelectionSprites(): void {
    const wanted = this.selectionIndices.filter((index) => this.isRenderedIndex(index));
    while (this.selectionSprites.length < wanted.length) {
      const sprite = new Sprite(this.selectionMaterial);
      sprite.renderOrder = 7;
      sprite.visible = false;
      sprite.scale.setScalar(2.4);
      this.selectionSprites.push(sprite);
      this.group.add(sprite);
    }
    while (this.selectionSprites.length > wanted.length) {
      const sprite = this.selectionSprites.pop();
      if (sprite) this.group.remove(sprite);
    }
    for (let i = 0; i < this.selectionSprites.length; i++) {
      const sprite = this.selectionSprites[i];
      const index = wanted[i];
      const atom = this.atoms[index];
      if (!atom) continue;
      sprite.userData.atomIndex = index;
      sprite.position.set(atom.position.x, atom.position.y, atom.position.z);
      this.setRingScale(sprite, index, 2.4);
      sprite.visible = !this.exportMode;
    }
  }

  private updateHoverVisibility(): void {
    if (this.exportMode) return;
    const index = this.hoverSprite.userData.atomIndex as number | undefined;
    if (index === undefined || !this.isRenderedIndex(index)) {
      this.hoverSprite.visible = false;
      return;
    }
    const atom = this.atoms[index];
    this.hoverSprite.position.set(atom.position.x, atom.position.y, atom.position.z);
    this.setRingScale(this.hoverSprite, index, 2.08);
    this.hoverSprite.visible = true;
  }

  /**
   * Hides the screen-space target rings and hover ring while exporting. Rings
   * are UI feedback, not part of the crystal, and must never be baked into a
   * WebP/GIF. Previous visibility is restored on exit.
   */
  setExportMode(enabled: boolean): void {
    if (enabled === this.exportMode) return;
    if (enabled) {
      this.exportSelectionWasVisible = this.selectionSprites.map((sprite) => sprite.visible);
      this.exportShellWasVisible = this.shellSprite.visible;
      for (const sprite of this.selectionSprites) sprite.visible = false;
      this.hoverSprite.visible = false;
      this.shellSprite.visible = false;
    } else {
      this.exportSelectionWasVisible.forEach((wasVisible, index) => {
        const sprite = this.selectionSprites[index];
        if (sprite) sprite.visible = wasVisible;
      });
      this.shellSprite.visible = this.exportShellWasVisible;
      this.updateHoverVisibility();
    }
    this.exportMode = enabled;
  }

  setHover(index: number | null): void {
    this.hoverSprite.userData.atomIndex = index ?? undefined;
    if (index === null) {
      this.hoverSprite.visible = false;
      return;
    }
    if (this.exportMode) return;
    const atom = this.atoms[index];
    if (!atom || !this.isRenderedIndex(index)) {
      this.hoverSprite.visible = false;
      return;
    }
    this.hoverSprite.position.set(atom.position.x, atom.position.y, atom.position.z);
    this.setRingScale(this.hoverSprite, index, 2.08);
    this.hoverSprite.visible = true;
  }

  getAtomAt(index: number): Atom | null {
    return this.atoms[index] ?? null;
  }

  getGhostInfo(): { blending: 'NormalBlending'; opacity: number; depthWrite: boolean } {
    return { blending: 'NormalBlending', opacity: 0.09, depthWrite: false };
  }

  getSelectionInfo(): { mode: 'target-ring'; hasCage: false; visible: boolean } {
    return {
      mode: 'target-ring',
      hasCage: false,
      visible: this.selectionSprites.some((sprite) => sprite.visible),
    };
  }

  getSelectedIndices(): number[] {
    return this.selectionIndices.slice();
  }

  getDisplayInfo(): {
    displayRadius: number;
    visibleCount: number;
    xrayCount: number;
    totalCount: number;
    hiddenCount: number;
    ringScale: number;
  } {
    const solidCount = this.getVisibleCount();
    const xrayCount = this.getXrayCount();
    return {
      displayRadius: this.displayRadius,
      visibleCount: solidCount,
      xrayCount,
      totalCount: this.atoms.length,
      hiddenCount: this.atoms.length - solidCount - xrayCount,
      ringScale: this.selectionSprites[0]?.scale.x ?? 0,
    };
  }

  dispose(): void {
    if (this.solidMesh) {
      this.group.remove(this.solidMesh);
      this.solidMesh.dispose();
      this.solidMesh = null;
    }
    if (this.ghostMesh) {
      this.group.remove(this.ghostMesh);
      this.ghostMesh.dispose();
      this.ghostMesh = null;
    }
    this.metalMaterial.dispose();
    this.ghostMaterial.dispose();
    this.selectionMaterial.dispose();
    this.hoverSprite.material.dispose();
    this.shellSprite.material.dispose();
    this.selectedTexture.dispose();
    this.hoverTexture.dispose();
    this.group.clear();
  }
}
