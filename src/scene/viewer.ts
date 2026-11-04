import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Intersection,
  type Object3D,
  type RenderTarget,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const CANONICAL_AZIMUTH = 0.58;
const CANONICAL_POLAR = 1.12;
const FOV = 40;
/** 18% margin: keeps the silhouette clear of the frame and the bottom rail. */
const BASE_MARGIN = 1.18;
/** 6% margin for preset content fits: full but not clipping. */
const CONTENT_MARGIN = 1.06;

interface CameraAnimation {
  startPosition: Vector3;
  endPosition: Vector3;
  startTarget: Vector3;
  endTarget: Vector3;
  startTime: number;
  duration: number;
}

export interface CameraSnapshot {
  position: [number, number, number];
  target: [number, number, number];
  distance: number;
  fov: number;
  azimuth: number;
  polar: number;
}

interface ExportRenderState {
  width: number;
  height: number;
  pixelRatio: number;
  clearColor: Color;
  clearAlpha: number;
  background: Scene['background'];
  cameraPosition: Vector3;
  target: Vector3;
  controlsEnabled: boolean;
  controlsAutoRotate: boolean;
}

export interface RendererInfo {
  width: number;
  height: number;
  pixelRatio: number;
  clearAlpha: number;
  exporting: boolean;
}

export interface ViewerOptions {
  frameRadius: number;
  reducedMotion?: boolean;
}

/**
 * Soft studio environment: a warm/cool gradient dome plus three very large
 * emissive panels. PMREM turns them into broad highlights instead of the six
 * hard square lights produced by RoomEnvironment.
 */
function buildEnvironmentScene(): Scene {
  const env = new Scene();

  const dome = new Mesh(
    new SphereGeometry(60, 32, 20),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPosition;
        void main() {
          float h = clamp(normalize(vPosition).y * 0.5 + 0.5, 0.0, 1.0);
          vec3 bottom = vec3(0.008, 0.012, 0.022);
          vec3 middle = vec3(0.055, 0.075, 0.095);
          vec3 top = vec3(0.24, 0.20, 0.16);
          vec3 color = mix(bottom, middle, smoothstep(0.0, 0.55, h));
          color = mix(color, top, smoothstep(0.55, 1.0, h));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }),
  );
  env.add(dome);

  const panel = (
    width: number,
    height: number,
    color: Color,
    position: [number, number, number],
  ) => {
    const mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ color, side: DoubleSide }),
    );
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };

  // Large warm key softbox, neutral cool fill, and a low warm bounce. Colours
  // are deliberately below the clipping point; ACES keeps the rest warm.
  panel(26, 18, new Color().setRGB(1.65, 1.4, 1.05), [16, 18, 14]);
  panel(20, 24, new Color().setRGB(0.55, 0.68, 0.8), [-20, 5, -12]);
  panel(22, 12, new Color().setRGB(0.85, 0.62, 0.4), [2, -17, 11]);

  return env;
}

/**
 * Owns renderer, camera, lighting and camera motion. Scene content lives in
 * layers added to `root` by the app.
 */
export class Viewer {
  readonly scene = new Scene();
  readonly root = new Group();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;

  private readonly canvas: HTMLCanvasElement;
  private readonly reducedMotion: boolean;
  private readonly raycaster = new Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private readonly environmentTarget: RenderTarget;
  private readonly settleListeners = new Set<() => void>();

  private frameRadius: number;
  private baseDistance = 30;
  private animation: CameraAnimation | null = null;
  private autoRotateEnabled = true;
  private selectionPaused = false;
  private dragPaused = false;
  private resumeTimer: number | null = null;
  private raf = 0;
  private started = false;
  private ready = false;
  private readyCallback: (() => void) | undefined;
  private exporting = false;
  private exportState: ExportRenderState | null = null;

  constructor(canvas: HTMLCanvasElement, options: ViewerOptions) {
    this.canvas = canvas;
    this.frameRadius = options.frameRadius;
    this.reducedMotion = options.reducedMotion ?? false;

    this.renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = false;

    this.camera = new PerspectiveCamera(FOV, 1, 0.1, 260);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.72;
    this.controls.zoomSpeed = 0.8;
    this.controls.minPolarAngle = Math.PI * 0.15;
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.target.set(0, 0, 0);

    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);

    this.setupLighting();
    const pmrem = new PMREMGenerator(this.renderer);
    const envScene = buildEnvironmentScene();
    this.environmentTarget = pmrem.fromScene(envScene, 0.03);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 1;
    for (const child of [...envScene.children]) {
      envScene.remove(child);
      if (child instanceof Mesh) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      }
    }
    pmrem.dispose();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.snapToCanonical(0);

    this.canvas.addEventListener('pointerdown', this.handlePointerDown, { passive: true });
    this.controls.addEventListener('start', this.handleControlStart);
    this.controls.addEventListener('end', this.handleControlEnd);

    this.applyAutoRotate();
  }

  private setupLighting(): void {
    const key = new DirectionalLight(0xffe4c2, 0.72);
    key.position.set(6.5, 9.5, 7.5);
    // Desaturated cool fill: a saturated cyan would tint the gold green.
    const fill = new DirectionalLight(0xa9c6d6, 0.2);
    fill.position.set(-8, -1.5, 6);
    const rim = new DirectionalLight(0xdbe9f5, 0.32);
    rim.position.set(-4, 5.5, -9);
    const bounce = new DirectionalLight(0xffc98a, 0.16);
    bounce.position.set(3, -7, -3);
    const hemi = new HemisphereLight(0x14202e, 0x02060f, 0.1);
    this.scene.add(key, fill, rim, bounce, hemi);
  }

  setFrameRadius(radius: number): void {
    this.frameRadius = radius;
    const previousBase = this.baseDistance;
    this.baseDistance = this.computeBaseDistance();
    const distance = this.controls.getDistance();
    if (!this.animation && Math.abs(distance - previousBase) < 0.25) {
      this.setDistance(this.baseDistance);
    }
  }

  getFrameRadius(): number {
    return this.frameRadius;
  }

  private effectiveMargin(): number {
    // Portrait is width-limited; 8% margin keeps the cell frame inside the
    // screen while letting the default atom cluster fill ~55% of the width.
    return this.canvas.clientWidth <= 860 ? 1.08 : BASE_MARGIN;
  }

  private computeBaseDistance(): number {
    return this.fitDistance(this.frameRadius, this.effectiveMargin());
  }

  fitDistance(radius: number, margin = 1.08): number {
    const aspect = Math.max(this.camera.aspect, 0.05);
    const vertical = (FOV * Math.PI) / 180;
    const halfVertical = vertical / 2;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
    const byVertical = radius / Math.sin(halfVertical);
    const byHorizontal = radius / Math.sin(halfHorizontal);
    return Math.max(byVertical, byHorizontal) * margin;
  }

  private viewOffsetShift(): number {
    return this.canvas.clientWidth <= 860 ? 0.03 : 0.065;
  }

  private applyViewOffset(width: number, height: number): void {
    // Shift the model slightly above the geometric centre so the bottom rail
    // never covers atoms. 0.078 was ~30px too high on desktop; the usable area
    // is the canvas above the rail, not the full canvas. The orbit target stays
    // (0,0,0) for every structure.
    const shift = this.viewOffsetShift();
    this.camera.setViewOffset(width, height, 0, Math.round(height * shift), width, height);
  }

  resize(): void {
    // A window resize while exporting would fight the square drawing buffer.
    if (this.exporting) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width < 2 || height < 2) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.applyViewOffset(width, height);
    this.camera.updateProjectionMatrix();

    const previousBase = this.baseDistance;
    this.baseDistance = this.computeBaseDistance();
    const distance = this.controls.getDistance();
    if (!this.animation && (Math.abs(distance - previousBase) < 0.35 || distance <= 0)) {
      this.setDistance(this.baseDistance);
    }
    this.controls.minDistance = this.baseDistance * 0.42;
    this.controls.maxDistance = this.baseDistance * 2.4;
    this.notifySettle();
  }

  private setDistance(distance: number): void {
    const direction = new Vector3().subVectors(this.camera.position, this.controls.target);
    if (direction.lengthSq() < 1e-9) direction.set(0.4, 0.5, 1);
    direction.normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  private canonicalPosition(target: Vector3, distance: number): Vector3 {
    const sinPolar = Math.sin(CANONICAL_POLAR);
    return new Vector3(
      target.x + distance * sinPolar * Math.sin(CANONICAL_AZIMUTH),
      target.y + distance * Math.cos(CANONICAL_POLAR),
      target.z + distance * sinPolar * Math.cos(CANONICAL_AZIMUTH),
    );
  }

  snapToCanonical(duration: number): void {
    this.animateTo(
      this.canonicalPosition(new Vector3(0, 0, 0), this.baseDistance),
      new Vector3(0, 0, 0),
      duration,
    );
  }

  resetView(duration = 450): void {
    const ms = this.reducedMotion ? Math.min(duration, 120) : duration;
    this.animateTo(
      this.canonicalPosition(new Vector3(0, 0, 0), this.baseDistance),
      new Vector3(0, 0, 0),
      ms,
    );
  }

  /**
   * "重置视角" now also lands in the fitted state: the canonical orbit
   * direction plus the distance that fits the currently visible content.
   */
  resetViewToFit(radius: number, duration = 450): void {
    const ms = this.reducedMotion ? Math.min(duration, 120) : duration;
    const distance = this.contentFitDistance(radius);
    this.animateTo(
      this.canonicalPosition(new Vector3(0, 0, 0), distance),
      new Vector3(0, 0, 0),
      ms,
    );
  }

  fitView(radius: number, duration = 450): void {
    const ms = this.reducedMotion ? Math.min(duration, 120) : duration;
    // Same formula as resetViewToFit(): "适应视图" and "重置视角" must land on
    // one identical distance so a reset really is the fitted state.
    const distance = this.contentFitDistance(radius);
    const target = this.controls.target.clone();
    const direction = new Vector3().subVectors(this.camera.position, target).normalize();
    const end = target.clone().addScaledVector(direction, distance);
    this.animateTo(end, target, ms);
  }

  /**
   * Preset framing: radius is measured from the world origin (cluster and
   * cell centre), so the orbit target returns to origin and any stale site
   * focus is dropped by the caller. The upward view offset shrinks the
   * effective top half-angle; folding it into the fit is what keeps a 100 %
   * cluster from clipping its top row.
   */
  fitToVisible(radius: number, duration = 450): void {
    const ms = this.reducedMotion ? Math.min(duration, 120) : duration;
    const distance = this.contentFitDistance(radius);
    const target = new Vector3(0, 0, 0);
    const direction = new Vector3().subVectors(this.camera.position, this.controls.target);
    if (direction.lengthSq() < 1e-9) {
      const sinPolar = Math.sin(CANONICAL_POLAR);
      direction.set(
        sinPolar * Math.sin(CANONICAL_AZIMUTH),
        Math.cos(CANONICAL_POLAR),
        sinPolar * Math.cos(CANONICAL_AZIMUTH),
      );
    }
    direction.normalize();
    const end = target.clone().addScaledVector(direction, distance);
    this.animateTo(end, target, ms);
  }

  private contentFitDistance(radius: number): number {
    const aspect = Math.max(this.camera.aspect, 0.05);
    const halfVertical = (FOV * Math.PI) / 360;
    const shift = this.viewOffsetShift();
    const visibleHalfVertical = Math.atan(Math.tan(halfVertical) * (1 - 2 * shift));
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
    return (
      Math.max(radius / Math.sin(visibleHalfVertical), radius / Math.sin(halfHorizontal)) *
      CONTENT_MARGIN
    );
  }

  focusTarget(worldTarget: Vector3 | null, duration = 450): void {
    const ms = this.reducedMotion ? Math.min(duration, 120) : duration;
    const endTarget = worldTarget ? worldTarget.clone() : new Vector3(0, 0, 0);
    const direction = new Vector3().subVectors(this.camera.position, this.controls.target);
    const distance = direction.length();
    if (distance < 1e-6) direction.set(0.4, 0.5, 1).normalize();
    else direction.normalize();
    const endPosition = endTarget.clone().addScaledVector(direction, distance);
    this.animateTo(endPosition, endTarget, ms);
  }

  onSettle(listener: () => void): () => void {
    this.settleListeners.add(listener);
    return () => this.settleListeners.delete(listener);
  }

  private notifySettle(): void {
    for (const listener of this.settleListeners) listener();
  }

  private animateTo(endPosition: Vector3, endTarget: Vector3, duration: number): void {
    this.cancelAnimation();
    if (duration <= 0) {
      this.camera.position.copy(endPosition);
      this.controls.target.copy(endTarget);
      this.camera.lookAt(endTarget);
      this.controls.update();
      this.applyAutoRotate();
      this.notifySettle();
      return;
    }
    this.animation = {
      startPosition: this.camera.position.clone(),
      endPosition,
      startTarget: this.controls.target.clone(),
      endTarget,
      startTime: performance.now(),
      duration,
    };
    this.controls.enabled = false;
    this.applyAutoRotate();
  }

  private stepAnimation(now: number): void {
    const animation = this.animation;
    if (!animation) return;
    const t = Math.min(1, (now - animation.startTime) / animation.duration);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.camera.position.lerpVectors(animation.startPosition, animation.endPosition, eased);
    this.controls.target.lerpVectors(animation.startTarget, animation.endTarget, eased);
    this.camera.lookAt(this.controls.target);
    if (t >= 1) {
      this.animation = null;
      this.controls.enabled = true;
      this.controls.update();
      this.applyAutoRotate();
      this.notifySettle();
    }
  }

  private cancelAnimation(): void {
    if (!this.animation) return;
    this.animation = null;
    this.controls.enabled = true;
  }

  private handlePointerDown = (): void => {
    if (this.animation) this.cancelAnimation();
  };

  private handleControlStart = (): void => {
    if (this.resumeTimer !== null) {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.dragPaused = true;
    this.applyAutoRotate();
  };

  private handleControlEnd = (): void => {
    if (this.resumeTimer !== null) window.clearTimeout(this.resumeTimer);
    this.resumeTimer = window.setTimeout(() => {
      this.resumeTimer = null;
      this.dragPaused = false;
      this.applyAutoRotate();
      this.notifySettle();
    }, 2500);
  };

  setAutoRotate(enabled: boolean): void {
    this.autoRotateEnabled = enabled;
    this.applyAutoRotate();
  }

  setAutoRotateSpeed(speed: number): void {
    this.controls.autoRotateSpeed = speed;
  }

  setSelectionPaused(paused: boolean): void {
    this.selectionPaused = paused;
    this.applyAutoRotate();
  }

  private applyAutoRotate(): void {
    this.controls.autoRotate =
      this.autoRotateEnabled && !this.selectionPaused && !this.dragPaused && !this.animation;
  }

  pick(ndc: Vector2, objects: Object3D[]): Intersection[] {
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(objects, false);
  }

  getCameraSnapshot(): CameraSnapshot {
    const offset = new Vector3().subVectors(this.camera.position, this.controls.target);
    const distance = offset.length();
    return {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
      distance,
      fov: this.camera.fov,
      azimuth: Math.atan2(offset.x, offset.z),
      polar: distance > 0 ? Math.acos(Math.max(-1, Math.min(1, offset.y / distance))) : 0,
    };
  }

  getBaseDistance(): number {
    return this.baseDistance;
  }

  start(onReady?: () => void): void {
    if (this.started) return;
    this.started = true;
    this.readyCallback = onReady;
    this.tick();
  }

  private tick = (): void => {
    if (this.exporting) return;
    this.raf = requestAnimationFrame(this.tick);
    this.stepAnimation(performance.now());
    if (!this.animation) this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (!this.ready) {
      this.ready = true;
      if (this.readyCallback) this.readyCallback();
    }
  };

  /**
   * Switches the main renderer to a square, DPR-1 export surface and stops
   * the screen rAF loop. Callers must invoke endExport() in a finally block.
   *
   * The PMREM environment is deliberately kept: a second WebGLRenderer would
   * own a different GL context and the existing PMREM texture would be
   * invalid there.
   */
  beginExport(size: number, clearColor: Color, clearAlpha: number): void {
    if (this.exporting) throw new Error('导出已在进行中');
    const sizeVector = this.renderer.getSize(new Vector2());
    this.exportState = {
      width: sizeVector.x,
      height: sizeVector.y,
      pixelRatio: this.renderer.getPixelRatio(),
      clearColor: this.renderer.getClearColor(new Color()),
      clearAlpha: this.renderer.getClearAlpha(),
      background: this.scene.background,
      cameraPosition: this.camera.position.clone(),
      target: this.controls.target.clone(),
      // A running camera animation disables OrbitControls. Since exporting
      // discards that animation, leaving controls disabled would be a bug.
      controlsEnabled: this.animation ? true : this.controls.enabled,
      controlsAutoRotate: this.controls.autoRotate,
    };

    this.exporting = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.animation = null;
    this.resizeObserver.disconnect();

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.setClearColor(clearColor, clearAlpha);
    this.scene.background = null;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
  }

  endExport(): void {
    const state = this.exportState;
    if (!state || !this.exporting) return;
    this.exportState = null;
    this.exporting = false;

    this.renderer.setPixelRatio(state.pixelRatio);
    this.renderer.setSize(state.width, state.height, false);
    this.renderer.setClearColor(state.clearColor, state.clearAlpha);
    this.scene.background = state.background;

    const width = Math.max(2, this.canvas.clientWidth || state.width);
    const height = Math.max(2, this.canvas.clientHeight || state.height);
    this.camera.aspect = width / height;
    this.applyViewOffset(width, height);
    this.camera.position.copy(state.cameraPosition);
    this.controls.target.copy(state.target);
    this.camera.lookAt(state.target);
    this.camera.updateProjectionMatrix();
    this.controls.enabled = state.controlsEnabled;
    this.controls.autoRotate = state.controlsAutoRotate;
    this.applyAutoRotate();
    this.controls.update();

    this.resizeObserver.observe(this.canvas);
    cancelAnimationFrame(this.raf);
    this.tick();
  }

  getRendererInfo(): RendererInfo {
    const size = this.renderer.getSize(new Vector2());
    return {
      width: size.x,
      height: size.y,
      pixelRatio: this.renderer.getPixelRatio(),
      clearAlpha: this.renderer.getClearAlpha(),
      exporting: this.exporting,
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.controls.removeEventListener('start', this.handleControlStart);
    this.controls.removeEventListener('end', this.handleControlEnd);
    this.controls.dispose();
    this.environmentTarget.dispose();
    this.renderer.dispose();
  }
}
