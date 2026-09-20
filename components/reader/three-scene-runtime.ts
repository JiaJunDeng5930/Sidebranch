import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshBasicMaterial,
  MOUSE,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Scene,
  TOUCH,
  Vector3,
  WebGLRenderer,
} from "three";
import {
  CSS3DObject,
  CSS3DRenderer,
} from "three/addons/renderers/CSS3DRenderer.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CAMERA_HOME,
  CAMERA_MAX_DISTANCE,
  CAMERA_MIN_DISTANCE,
  createPerspectiveCamera,
  paperPoint,
  paperToWorld,
  screenRaycaster,
  setPaperObjectTransform,
  snapshotCameraPose,
  synchronizePerspectiveCamera,
  toThreeQuaternion,
  toThreeWorld,
  type CameraPose,
  type CameraViewport,
  type PaperPoint,
  type PaperPose,
  type ScreenPoint,
} from "../../lib/reader/camera";
import {
  PAPER_GEOMETRY,
  type PaperInstance,
} from "../../lib/reader/paper-geometry";
import { buildPassageBandGeometry } from "../../lib/reader/range-ribbon";
import type { ConnectionId } from "../../lib/domain/model";
import type { PassageMouth } from "../../lib/reader/passage-mouth";
import type { SpaceView } from "../../lib/reader/space-view";
import type { SurfaceInstanceId } from "../../lib/reader/spatial-contract";

export type SceneBand = Readonly<{
  id: ConnectionId;
  from: PassageMouth;
  to: PassageMouth;
  color: string;
}>;
type PaperRuntime = {
  instance: PaperInstance;
  object: CSS3DObject;
  mask: Mesh<PlaneGeometry, MeshBasicMaterial>;
};
type BandRuntime = {
  band: SceneBand;
  mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
};
export type CameraInputCallbacks = {
  start(): void;
  change(camera: CameraPose): void;
  end(): void;
};

export function configureSceneControls(controls: OrbitControls): void {
  controls.enableDamping = false;
  controls.autoRotate = false;
  controls.screenSpacePanning = true;
  controls.minDistance = CAMERA_MIN_DISTANCE;
  controls.maxDistance = CAMERA_MAX_DISTANCE;
  controls.mouseButtons = {
    LEFT: MOUSE.PAN,
    MIDDLE: MOUSE.DOLLY,
    RIGHT: MOUSE.ROTATE,
  };
  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
}

/** Owns mutable Three objects and renderer lifetime; domain views remain immutable snapshots. */
export class ThreeSceneRuntime {
  readonly camera: PerspectiveCamera;
  readonly cssRenderer = new CSS3DRenderer();
  readonly webglRenderer: WebGLRenderer;
  readonly paperElements = new Map<SurfaceInstanceId, HTMLElement>();
  private readonly paperScene = new Scene();
  private readonly maskScene = new Scene();
  private readonly bandScene = new Scene();
  private readonly papers = new Map<SurfaceInstanceId, PaperRuntime>();
  private readonly bands = new Map<ConnectionId, BandRuntime>();
  private readonly maskGeometry = new PlaneGeometry(
    PAPER_GEOMETRY.width,
    PAPER_GEOMETRY.height,
  );
  private readonly maskMaterial = new MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    side: FrontSide,
  });
  private readonly captures = new Set<number>();
  private controls: OrbitControls;
  private reference = CAMERA_HOME;
  private viewport: CameraViewport = { width: 1, height: 1 };
  private frame: number | null = null;
  private synchronizing = false;
  private disposed = false;
  private controlsEnabled = true;

  constructor(
    private readonly host: HTMLElement,
    private readonly background: HTMLElement,
    private readonly input: CameraInputCallbacks,
  ) {
    this.camera = createPerspectiveCamera(this.reference, this.viewport);
    this.webglRenderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    this.webglRenderer.autoClear = false;
    this.webglRenderer.setClearColor(0, 0);
    this.cssRenderer.domElement.className = "spatial-css-renderer";
    this.webglRenderer.domElement.className = "spatial-webgl-renderer";
    this.webglRenderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(this.cssRenderer.domElement);
    host.appendChild(this.webglRenderer.domElement);
    this.controls = this.createControls();
    background.addEventListener("pointerdown", this.trackPointer, true);
    background.addEventListener("pointerup", this.untrackPointer, true);
  }
  private trackPointer = (event: PointerEvent) => {
    this.captures.add(event.pointerId);
  };
  private untrackPointer = (event: PointerEvent) => {
    this.captures.delete(event.pointerId);
  };
  private createControls(): OrbitControls {
    const pose = this.reference;
    this.camera.up
      .set(0, 1, 0)
      .applyQuaternion(toThreeQuaternion(pose.orientation));
    const controls = new OrbitControls(this.camera, this.background);
    configureSceneControls(controls);
    controls.enabled = this.controlsEnabled;
    controls.target.copy(toThreeWorld(pose.target));
    synchronizePerspectiveCamera(this.camera, pose, this.viewport);
    controls.update();
    controls.addEventListener("start", () => {
      if (!this.synchronizing) this.input.start();
    });
    controls.addEventListener("change", () => {
      if (!this.synchronizing) this.input.change(this.cameraSnapshot());
      this.requestRender();
    });
    controls.addEventListener("end", () => {
      if (!this.synchronizing) this.input.end();
    });
    return controls;
  }
  get measurementRoot(): HTMLElement | null {
    return this.cssRenderer.domElement.firstElementChild
      ?.firstElementChild as HTMLElement | null;
  }
  cameraSnapshot(): CameraPose {
    return snapshotCameraPose(
      this.camera,
      this.controls.target,
      this.reference,
    );
  }
  synchronizeCamera(pose: CameraPose): void {
    const position = toThreeWorld(pose.position),
      target = toThreeWorld(pose.target),
      rotation = toThreeQuaternion(pose.orientation);
    const changed =
      this.camera.position.distanceToSquared(position) > 1e-12 ||
      this.controls.target.distanceToSquared(target) > 1e-12 ||
      1 - Math.abs(this.camera.quaternion.dot(rotation)) > 1e-12;
    this.reference = pose;
    this.synchronizing = true;
    if (changed) {
      // Recreate controls only for external camera restoration. Its orbit-up basis is
      // established at construction, so a restored rolled paper must set that basis too.
      this.controls.dispose();
      this.controls = this.createControls();
    } else synchronizePerspectiveCamera(this.camera, pose, this.viewport);
    this.synchronizing = false;
    this.requestRender();
  }
  setControlsEnabled(enabled: boolean): void {
    this.controlsEnabled = enabled;
    this.controls.enabled = enabled;
  }
  cancelCameraInput(): void {
    const pose = this.cameraSnapshot();
    this.synchronizing = true;
    this.controls.dispose();
    for (const id of this.captures) {
      try {
        if (this.background.hasPointerCapture(id))
          this.background.releasePointerCapture(id);
      } catch {}
    }
    this.captures.clear();
    // disconnect/connect retains OrbitControls' active pointer and movement
    // state. Recreate it so involuntary capture loss cannot continue a draft.
    this.reference = pose;
    this.controls = this.createControls();
    this.synchronizing = false;
  }
  resize(viewport: CameraViewport): void {
    this.viewport = viewport;
    this.cssRenderer.setSize(viewport.width, viewport.height);
    this.webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.webglRenderer.setSize(viewport.width, viewport.height, false);
    synchronizePerspectiveCamera(this.camera, this.cameraSnapshot(), viewport);
    this.requestRender();
  }
  setPapers(instances: readonly PaperInstance[]): boolean {
    let collectionChanged = false;
    const retained = new Set(instances.map((paper) => paper.surfaceId));
    for (const [id, paper] of this.papers)
      if (!retained.has(id)) {
        paper.object.removeFromParent();
        paper.mask.removeFromParent();
        this.papers.delete(id);
        this.paperElements.delete(id);
        collectionChanged = true;
      }
    for (const instance of instances) {
      let paper = this.papers.get(instance.surfaceId);
      if (!paper) {
        const element = document.createElement("article");
        element.className = "spatial-paper";
        element.dataset.paper = "";
        element.dataset.surfaceKey = instance.surfaceId;
        element.style.width = `${instance.geometry.width}px`;
        element.style.height = `${instance.geometry.height}px`;
        const object = new CSS3DObject(element);
        // CSS3DObject defaults to user-select:none; native passage selection is intentional.
        element.style.userSelect = "text";
        const mask = new Mesh(this.maskGeometry, this.maskMaterial);
        mask.userData.surfaceId = instance.surfaceId;
        this.paperScene.add(object);
        this.maskScene.add(mask);
        paper = { instance, object, mask };
        this.papers.set(instance.surfaceId, paper);
        this.paperElements.set(instance.surfaceId, element);
        collectionChanged = true;
      }
      paper.instance = instance;
      setPaperObjectTransform(paper.object, instance.pose);
      setPaperObjectTransform(paper.mask, instance.pose);
    }
    this.refreshBandPositions();
    this.render();
    return collectionChanged;
  }
  applyView(
    view: SpaceView,
    poseFor: (view: SpaceView, id: SurfaceInstanceId) => PaperPose,
  ): void {
    this.synchronizeCamera(view.camera);
    let moved = false;
    for (const [id, paper] of this.papers) {
      const pose = poseFor(view, id);
      if (paper.instance.pose === pose) continue;
      paper.instance = { ...paper.instance, pose };
      setPaperObjectTransform(paper.object, pose);
      setPaperObjectTransform(paper.mask, pose);
      moved = true;
    }
    if (moved) this.refreshBandPositions();
    this.requestRender();
  }
  setBands(bands: readonly SceneBand[]): void {
    const retained = new Set(bands.map((band) => band.id));
    for (const [id, entry] of this.bands)
      if (!retained.has(id)) {
        entry.mesh.removeFromParent();
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
        this.bands.delete(id);
      }
    for (const band of bands) {
      let entry = this.bands.get(band.id);
      if (!entry) {
        const mesh = new Mesh(
          new BufferGeometry(),
          new MeshBasicMaterial({
            color: band.color,
            transparent: true,
            opacity: 0.3,
            side: DoubleSide,
            depthTest: true,
            depthWrite: false,
          }),
        );
        mesh.userData.connectionId = band.id;
        entry = { band, mesh };
        this.bands.set(band.id, entry);
        this.bandScene.add(mesh);
      }
      entry.band = band;
      entry.mesh.material.color.set(band.color);
    }
    this.refreshBandPositions();
    this.requestRender();
  }
  private worldMouth(mouth: PassageMouth) {
    const paper = this.papers.get(mouth.surfaceId);
    if (!paper) return null;
    const { pose, geometry } = paper.instance;
    const offset = new Vector3(0, 0, 0.7).applyQuaternion(
      toThreeQuaternion(pose.orientation),
    );
    const convert = (point: PaperPoint) => {
      const world = toThreeWorld(
        paperToWorld(point, pose, geometry.width, geometry.height),
      ).add(offset);
      return { x: world.x, y: -world.y, z: world.z } as ReturnType<
        typeof paperToWorld
      >;
    };
    return { start: convert(mouth.start), end: convert(mouth.end) };
  }
  private refreshBandPositions(): void {
    for (const { band, mesh } of this.bands.values()) {
      const from = this.worldMouth(band.from),
        to = this.worldMouth(band.to);
      mesh.visible = !!from && !!to;
      if (!from || !to) continue;
      const data = buildPassageBandGeometry(from, to);
      for (let i = 1; i < data.positions.length; i += 3)
        data.positions[i] *= -1;
      const position = mesh.geometry.getAttribute("position");
      if (position) {
        (position.array as Float32Array).set(data.positions);
        position.needsUpdate = true;
      } else {
        mesh.geometry.setAttribute(
          "position",
          new BufferAttribute(data.positions, 3),
        );
        mesh.geometry.setIndex(new BufferAttribute(data.indices, 1));
        mesh.geometry.setAttribute(
          "uv",
          new BufferAttribute(
            new Float32Array(
              Array.from(data.endpointWeights).flatMap((weight) => [weight, 0]),
            ),
            2,
          ),
        );
      }
      mesh.geometry.computeBoundingSphere();
    }
  }
  hitPaper(id: SurfaceInstanceId, point: ScreenPoint): PaperPoint | null {
    const paper = this.papers.get(id);
    if (!paper) return null;
    const hit = screenRaycaster(
      point,
      this.camera,
      this.viewport,
    ).intersectObject(paper.mask, false)[0];
    if (!hit) return null;
    const local = paper.mask.worldToLocal(hit.point.clone());
    return paperPoint(
      local.x + paper.instance.geometry.width / 2,
      paper.instance.geometry.height / 2 - local.y,
    );
  }
  pickBand(
    point: ScreenPoint,
  ): { connectionId: ConnectionId; endpoint: "from" | "to" } | null {
    this.maskScene.updateMatrixWorld(true);
    this.bandScene.updateMatrixWorld(true);
    const objects = [...this.papers.values()]
      .map((paper) => paper.mask)
      .concat([]);
    const hits = screenRaycaster(
      point,
      this.camera,
      this.viewport,
    ).intersectObjects(
      [
        ...objects,
        ...[...this.bands.values()]
          .filter(({ mesh }) => mesh.visible)
          .map(({ mesh }) => mesh),
      ],
      false,
    );
    const first = hits[0];
    if (!first?.object.userData.connectionId) return null;
    return {
      connectionId: first.object.userData.connectionId as ConnectionId,
      endpoint: (first.uv?.x ?? 0) <= 0.5 ? "from" : "to",
    };
  }
  wheelCamera(
    deltaX: number,
    deltaY: number,
    dolly: boolean,
    point: ScreenPoint,
  ): CameraPose {
    this.synchronizing = true;
    if (dolly) {
      const normal = this.camera.getWorldDirection(new Vector3());
      const plane = new Plane().setFromNormalAndCoplanarPoint(
        normal,
        this.controls.target,
      );
      const before = screenRaycaster(
        point,
        this.camera,
        this.viewport,
      ).ray.intersectPlane(plane, new Vector3());
      this.controls.dollyOut(Math.exp(-deltaY * 0.003));
      this.camera.updateMatrixWorld(true);
      const after = screenRaycaster(
        point,
        this.camera,
        this.viewport,
      ).ray.intersectPlane(plane, new Vector3());
      if (before && after) {
        const move = before.sub(after);
        this.camera.position.add(move);
        this.controls.target.add(move);
        this.controls.update();
      }
    } else this.controls.pan(-deltaX, -deltaY);
    this.synchronizing = false;
    this.requestRender();
    return this.cameraSnapshot();
  }
  requestRender(): void {
    if (this.frame !== null || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }
  render(): void {
    if (this.disposed) return;
    this.cssRenderer.render(this.paperScene, this.camera);
    const renderer = this.webglRenderer;
    // The overlay exposes the DOM wherever color remains transparent. Paper depth
    // must survive between these passes for bands behind native text to be hidden.
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clear(true, true, true);
    renderer.render(this.maskScene, this.camera);
    renderer.render(this.bandScene, this.camera);
    renderer.autoClear = autoClear;
  }
  dispose(): void {
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.cancelCameraInput();
    this.controls.dispose();
    this.background.removeEventListener("pointerdown", this.trackPointer, true);
    this.background.removeEventListener("pointerup", this.untrackPointer, true);
    for (const { object } of this.papers.values()) object.removeFromParent();
    for (const { mesh } of this.bands.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.maskGeometry.dispose();
    this.maskMaterial.dispose();
    this.webglRenderer.dispose();
    this.webglRenderer.forceContextLoss();
    this.cssRenderer.domElement.remove();
    this.webglRenderer.domElement.remove();
    this.papers.clear();
    this.bands.clear();
    this.paperElements.clear();
  }
}
