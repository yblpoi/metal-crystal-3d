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

/**
 * Ring stroke widths are in texture texels. The sprite covers ~2.5 world units
 * over 256 texels, so 9.5 tx lands at roughly 3 CSS px at the default framing;
 * 7.5 tx is the ~2 px hover ring.
 */
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
 * Instanced hard spheres. The underlying atom radius is always exactly 1 in
 * crystal units; the instance scale is a display-only factor so the same unit
 * geometry can be shrunk without touching the crystallographic data.
 *
 * Selection and hover are screen-aligned target rings (canvas sprites), not
 * polyhedral cages: a cuboctahedron would be the correct CN-12 shape for FCC,
 * and any hand-built cage would misrepresent the local coordination.
 */
export class AtomLayer {
  readonly group = new Group();
  private readonly metalMaterial: MeshPhysicalMaterial;
  private readonly ghostMaterial: ShaderMaterial;
  private readonly selectionSprite: Sprite;
  private readonly hoverSprite: Sprite;
  private readonly shellSprite: Sprite;
  private readonly selectedTexture: CanvasTexture;
  private readonly hoverTexture: CanvasTexture;
  private readonly color = new Color();
  private readonly matrix = new Matrix4();
  private currentMesh: InstancedMesh | null = null;
  private atoms: Atom[] = [];
  private visible: boolean[] = [];
  private displayRadius = 1;
  private shellCenterIndex: number | null = null;
  private colorKey = '';
  private ghost = false;
  private exportMode = false;
  private exportSelectionWasVisible = false;
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
    this.selectionSprite = new Sprite(
      new SpriteMaterial({
        map: this.selectedTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.hoverSprite = new Sprite(
      new SpriteMaterial({
        map: this.hoverTexture,
        transparent: true,
        opacity: 0.55,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.shellSprite = new Sprite(
      new SpriteMaterial({
        map: this.selectedTexture,
        transparent: true,
        opacity: 0.78,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.selectionSprite.scale.setScalar(2.5);
    this.hoverSprite.scale.setScalar(2.12);
    this.shellSprite.scale.setScalar(2.4);
    this.selectionSprite.renderOrder = 7;
    this.hoverSprite.renderOrder = 6;
    this.shellSprite.renderOrder = 6;
    this.selectionSprite.visible = false;
    this.hoverSprite.visible = false;
    this.shellSprite.visible = false;
    this.group.add(this.hoverSprite, this.shellSprite, this.selectionSprite);
  }

  build(model: CrystalModel): void {
    this.atoms = model.atoms;
    this.colorKey = '';
    const material = this.ghost ? this.ghostMaterial : this.metalMaterial;
    const mesh = new InstancedMesh(ATOM_GEOMETRY, material, this.atoms.length);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = this.ghost ? 3 : 0;
    this.visible = this.atoms.map(() => true);
    this.replaceMesh(mesh);
    this.writeMatrices();
    this.setSelected(null);
    this.setHover(null);
    this.setShellCenter(null);
  }

  /**
   * Display-only update: hidden atoms keep their slot in the InstancedMesh (so
   * setColorAt indices stay aligned with CrystalModel.atoms) but receive a zero
   * scale. Visible atoms all receive exactly the same scale.
   */
  setDisplay(visible: boolean[], radius: number): void {
    if (visible.length !== this.atoms.length) return;
    this.visible = visible.slice();
    this.displayRadius = Math.min(1, Math.max(0.5, radius));
    this.writeMatrices();
    this.updateRingScale();

    const selected = this.selectionSprite.userData.atomIndex as number | undefined;
    if (selected !== undefined && !this.isVisibleIndex(selected)) {
      this.selectionSprite.visible = false;
    }
    const hovered = this.hoverSprite.userData.atomIndex as number | undefined;
    if (hovered !== undefined && !this.isVisibleIndex(hovered)) {
      this.hoverSprite.visible = false;
    }
    if (this.shellCenterIndex !== null && !this.isVisibleIndex(this.shellCenterIndex)) {
      this.shellSprite.visible = false;
    }
  }

  private writeMatrices(): void {
    const mesh = this.currentMesh;
    if (!mesh) return;
    for (let i = 0; i < this.atoms.length; i++) {
      const atom = this.atoms[i];
      const scale = this.visible[i] ? this.displayRadius : 0;
      this.matrix.makeScale(scale, scale, scale);
      this.matrix.setPosition(atom.position.x, atom.position.y, atom.position.z);
      mesh.setMatrixAt(i, this.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = this.atoms.length;
  }

  private updateRingScale(): void {
    this.selectionSprite.scale.setScalar(2.4 * this.displayRadius);
    this.hoverSprite.scale.setScalar(2.08 * this.displayRadius);
    this.shellSprite.scale.setScalar(2.4 * this.displayRadius);
  }

  /**
   * Cyan target ring for the coordination-shell centre. UI-only feedback: it
   * is hidden while exporting, while the coordination polyhedron next to it is
   * content and stays in the file.
   */
  setShellCenter(index: number | null): void {
    this.shellCenterIndex = index;
    const atom = index === null ? null : this.atoms[index];
    if (!atom || !this.isVisibleIndex(index!)) {
      this.shellSprite.visible = false;
      return;
    }
    this.shellSprite.position.set(atom.position.x, atom.position.y, atom.position.z);
    this.updateRingScale();
    this.shellSprite.visible = !this.exportMode;
  }

  getShellRingInfo(): { visible: boolean; index: number | null; scale: number } {
    return {
      visible: this.shellSprite.visible,
      index: this.shellCenterIndex,
      scale: this.shellSprite.scale.x,
    };
  }

  isVisibleIndex(index: number): boolean {
    return this.visible[index] === true;
  }

  getVisibleCount(): number {
    let count = 0;
    for (const value of this.visible) if (value) count++;
    return count;
  }

  getDisplayRadius(): number {
    return this.displayRadius;
  }

  private replaceMesh(next: InstancedMesh): void {
    if (this.currentMesh) {
      this.group.remove(this.currentMesh);
      this.currentMesh.dispose();
    }
    this.currentMesh = next;
    this.group.add(next);
  }

  get instancedMesh(): InstancedMesh | null {
    return this.currentMesh;
  }

  get atomCount(): number {
    return this.atoms.length;
  }

  setColors(colors: string[]): void {
    const mesh = this.currentMesh;
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

  setGhost(enabled: boolean): void {
    if (this.ghost === enabled) return;
    this.ghost = enabled;
    const mesh = this.currentMesh;
    if (!mesh) return;
    mesh.material = enabled ? this.ghostMaterial : this.metalMaterial;
    mesh.renderOrder = enabled ? 3 : 0;
  }

  setVisible(visible: boolean): void {
    if (this.currentMesh) this.currentMesh.visible = visible;
  }

  setSelected(index: number | null): void {
    const atom = index === null ? null : this.atoms[index];
    this.selectionSprite.userData.atomIndex = index ?? undefined;
    if (!atom || !this.isVisibleIndex(index!)) {
      this.selectionSprite.visible = false;
      return;
    }
    this.selectionSprite.position.set(atom.position.x, atom.position.y, atom.position.z);
    this.updateRingScale();
    this.selectionSprite.visible = !this.exportMode;
  }

  /**
   * Hides the screen-space target ring and hover ring while exporting. The
   * ring is UI feedback, not part of the crystal and must never be baked into
   * a WebP/GIF. Previous visibility is restored on exit.
   */
  setExportMode(enabled: boolean): void {
    if (enabled === this.exportMode) return;
    if (enabled) {
      this.exportSelectionWasVisible = this.selectionSprite.visible;
      this.exportShellWasVisible = this.shellSprite.visible;
      this.selectionSprite.visible = false;
      this.hoverSprite.visible = false;
      this.shellSprite.visible = false;
    } else {
      this.selectionSprite.visible = this.exportSelectionWasVisible;
      this.shellSprite.visible = this.exportShellWasVisible;
    }
    this.exportMode = enabled;
  }

  setHover(index: number | null): void {
    this.hoverSprite.userData.atomIndex = index ?? undefined;
    if (this.exportMode) return;
    const atom = index === null ? null : this.atoms[index];
    if (!atom || !this.isVisibleIndex(index!)) {
      this.hoverSprite.visible = false;
      return;
    }
    this.hoverSprite.position.set(atom.position.x, atom.position.y, atom.position.z);
    this.updateRingScale();
    this.hoverSprite.visible = true;
  }

  getAtomAt(index: number): Atom | null {
    return this.atoms[index] ?? null;
  }

  getGhostInfo(): { blending: 'NormalBlending'; opacity: number; depthWrite: boolean } {
    return { blending: 'NormalBlending', opacity: 0.09, depthWrite: false };
  }

  getSelectionInfo(): { mode: 'target-ring'; hasCage: false; visible: boolean } {
    return { mode: 'target-ring', hasCage: false, visible: this.selectionSprite.visible };
  }

  getDisplayInfo(): {
    displayRadius: number;
    visibleCount: number;
    totalCount: number;
    hiddenCount: number;
    ringScale: number;
  } {
    return {
      displayRadius: this.displayRadius,
      visibleCount: this.getVisibleCount(),
      totalCount: this.atoms.length,
      hiddenCount: this.atoms.length - this.getVisibleCount(),
      ringScale: this.selectionSprite.scale.x,
    };
  }

  dispose(): void {
    if (this.currentMesh) {
      this.group.remove(this.currentMesh);
      this.currentMesh.dispose();
      this.currentMesh = null;
    }
    this.metalMaterial.dispose();
    this.ghostMaterial.dispose();
    this.selectionSprite.material.dispose();
    this.hoverSprite.material.dispose();
    this.shellSprite.material.dispose();
    this.selectedTexture.dispose();
    this.hoverTexture.dispose();
    this.group.clear();
  }
}
