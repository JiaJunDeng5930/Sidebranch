"use client";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  SpatialSceneProps as Contract,
  ReadingSurface,
  PassageHandle,
  SurfaceInstanceId,
  DocumentRenderContext,
} from "../../lib/reader/spatial-contract";
import type { AnchorInput } from "../../lib/domain/model";
import type { SpaceView } from "../../lib/reader/space-view";
import {
  fitCameraToPapers,
  focusCamera,
  paperToWorld,
  screenPoint,
  toThreeQuaternion,
  toThreeWorld,
  type CameraViewport,
  type CameraPose,
} from "../../lib/reader/camera";
import {
  paperGeometryForViewport,
  type PaperGeometry,
} from "../../lib/reader/paper-geometry";
import { arrangeReading } from "../../lib/reader/reading-presentation";
import { interpolateReadingFrame } from "./reading-transition";
import {
  SceneGeometry,
  resolvePassageMouth,
  visibleAnchorFragments,
} from "./scene-geometry";
import { defaultPaperPose, rangeScrollTarget } from "./scene-presentation";
import { SceneInteraction } from "./scene-interaction";
import { ScenePaper, type PaperProxy } from "./scene-paper";
import { ThreeSceneRuntime, type SceneBand } from "./three-scene-runtime";
import { desiredFullText } from "../../lib/reader/space-residency";
import { relationStyle } from "../../lib/reader/semantic-palette";
import "./spatial-scene.css";
export interface SpatialSceneController {
  cancelInput(): void;
  measure(): void;
}
export type SpatialSceneProps = Omit<
  Contract,
  "renderDocument" | "renderDocumentMenu"
> & {
  controllerRef?: React.Ref<SpatialSceneController>;
  renderDocument(
    surface: ReadingSurface,
    context: DocumentRenderContext,
  ): React.ReactNode;
  renderDocumentMenu?(surface: ReadingSurface): React.ReactNode;
};
const initialViewport = { width: 1280, height: 850 };
export function SpatialScene(props: SpatialSceneProps) {
  const viewportRef = useRef<HTMLDivElement>(null),
    backgroundRef = useRef<HTMLDivElement>(null),
    rendererHostRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<ThreeSceneRuntime | null>(null),
    interaction = useRef(new SceneInteraction());
  const nodes = useRef(new Map<SurfaceInstanceId, HTMLElement>()),
    passages = useRef(new Map<SurfaceInstanceId, PassageHandle>());
  const geometry = useRef(new SceneGeometry()),
    anchors = useRef(new Map<SurfaceInstanceId, readonly AnchorInput[]>());
  const propsRef = useRef(props),
    live = useRef(props.view),
    viewportValue = useRef<CameraViewport>(initialViewport);
  const resident = useRef(new Set<SurfaceInstanceId>()),
    pinned = useRef(new Set<SurfaceInstanceId>());
  const [viewport, setViewport] = useState(initialViewport),
    [portalElements, setPortalElements] = useState(
      new Map<SurfaceInstanceId, HTMLElement>(),
    );
  const [measureEpoch, setMeasureEpoch] = useState(0),
    [proxies, setProxies] = useState(
      new Map<SurfaceInstanceId, PaperProxy[]>(),
    );
  // Placement memory is intentionally excluded: checkpoint echoes never restart reading.
  const arrangementKey = `${props.presentation.id}:${props.reading.primary}:${props.reading.companion}:${props.reading.connectionId}:${viewport.width}:${viewport.height}`;
  const arrangement = useMemo(
    () =>
      arrangeReading({
        intent: props.reading,
        view: props.view,
        viewport,
        surfaceIds: props.surfaces.map((surface) => surface.surfaceId),
        trail: props.readingTrail,
        bodyFontSize: viewport.width <= 620 ? 28 : 24,
      }),
    // One arrangement per explicit reading action or viewport change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arrangementKey],
  );
  const displayedGeometry = useRef<
    ReadonlyMap<SurfaceInstanceId, PaperGeometry>
  >(arrangement.geometry);
  const transition = useRef<number | null>(null);
  const stopPresentation = useCallback(() => {
    if (transition.current !== null) {
      cancelAnimationFrame(transition.current);
      transition.current = null;
      geometry.current.invalidate();
      setMeasureEpoch((epoch) => epoch + 1);
    }
  }, []);
  const shapeFor = useCallback(
    (id: SurfaceInstanceId) =>
      displayedGeometry.current.get(id) ??
      (propsRef.current.reading.primary
        ? { width: 600, height: 100 }
        : paperGeometryForViewport(viewportValue.current)),
    [],
  );
  const checkpoint = useCallback(
    (
      value: { generation: number; view: SpaceView },
      movedSurfaceId?: SurfaceInstanceId,
    ) => {
      const saved = new Map(propsRef.current.view.placements);
      if (movedSurfaceId) {
        const pose = value.view.placements.get(movedSurfaceId);
        if (pose) saved.set(movedSurfaceId, pose);
      }
      propsRef.current.onViewCheckpoint({
        generation: value.generation,
        view: { ...value.view, placements: saved },
      });
    },
    [],
  );
  useLayoutEffect(() => {
    propsRef.current = props;
    viewportValue.current = viewport;
  }, [props, viewport]);
  const [desired, setDesired] = useState<SurfaceInstanceId[]>([]);
  useLayoutEffect(() => {
    const next = props.reading.primary
      ? [
          ...new Set([...arrangement.readableSurfaceIds, ...pinned.current]),
        ].filter((id) =>
          props.surfaces.some((surface) => surface.surfaceId === id),
        )
      : desiredFullText(props.surfaces, live.current, viewport, {
          resident: resident.current,
          pinned: pinned.current,
        });
    setDesired((previous) =>
      previous.length === next.length &&
      previous.every((id, index) => id === next[index])
        ? previous
        : next,
    );
  }, [props.surfaces, arrangement, viewport, measureEpoch]);
  const desiredIds = useMemo(() => new Set(desired), [desired]);
  useLayoutEffect(() => {
    resident.current = desiredIds;
  }, [desiredIds]);
  const onDemandSurfaces = props.onDemandSurfaces;
  useEffect(() => {
    onDemandSurfaces(desired);
  }, [desired, onDemandSurfaces]);
  const loaded = useMemo(
    () =>
      props.surfaces.flatMap((surface) =>
        surface.document && desiredIds.has(surface.surfaceId)
          ? [
              {
                surfaceId: surface.surfaceId,
                position: surface.position,
                document: surface.document,
              },
            ]
          : [],
      ),
    [props.surfaces, desiredIds],
  );
  const poseFor = useCallback(
    (value: SpaceView, id: SurfaceInstanceId) =>
      value.placements.get(id) ??
      defaultPaperPose(
        Math.max(
          0,
          propsRef.current.surfaces.findIndex(
            (surface) => surface.surfaceId === id,
          ),
        ),
      ),
    [],
  );
  const paint = useCallback(
    (value: SpaceView) => {
      live.current = value;
      runtime.current?.applyView(value, poseFor);
    },
    [poseFor],
  );
  const invalidate = useCallback(
    (id?: SurfaceInstanceId) => {
      geometry.current.invalidate(id);
      setMeasureEpoch((epoch) => epoch + 1);
    },
    [setMeasureEpoch],
  );
  const registerPassage = useCallback(
    (id: SurfaceInstanceId, handle: PassageHandle | null) => {
      if (handle) passages.current.set(id, handle);
      else {
        passages.current.delete(id);
        geometry.current.invalidate(id);
      }
    },
    [],
  );
  const registerAnchors = useCallback(
    (id: SurfaceInstanceId, value: readonly AnchorInput[]) => {
      anchors.current.set(id, value);
      setMeasureEpoch((epoch) => epoch + 1);
    },
    [setMeasureEpoch],
  );
  const hitTestAnchor = useCallback(
    (
      id: SurfaceInstanceId,
      anchor: AnchorInput,
      point: { x: number; y: number },
    ) => {
      const owner = geometry.current,
        layout = owner.layouts.get(id),
        root = viewportRef.current;
      const surface = propsRef.current.surfaces.find(
        (item) => item.surfaceId === id,
      );
      const scroll = nodes.current
        .get(id)
        ?.querySelector<HTMLElement>("[data-document-scroll]");
      if (
        !layout ||
        !scroll ||
        !root ||
        !surface ||
        surface.position.revisionId !== anchor.revisionId
      )
        return false;
      const rect = root.getBoundingClientRect();
      const hit = runtime.current?.hitPaper(
        id,
        screenPoint(point.x - rect.left, point.y - rect.top),
      );
      const cached = owner.resolveAnchor(id, anchor, undefined, scroll, false);
      return (
        !!hit &&
        !!cached &&
        visibleAnchorFragments(cached, layout, scroll).some(
          (part) =>
            hit.x >= part.left &&
            hit.x <= part.right &&
            hit.y >= part.top &&
            hit.y <= part.bottom,
        )
      );
    },
    [],
  );
  const focus = useCallback((id: SurfaceInstanceId) => {
    if (!interaction.current.consumeClick() && live.current.focus !== id)
      propsRef.current.onFocusSurface(id);
  }, []);

  useLayoutEffect(() => {
    const node = viewportRef.current,
      background = backgroundRef.current,
      host = rendererHostRef.current;
    if (!node || !background || !host) return;
    const owner = interaction.current;
    const scene = new ThreeSceneRuntime(host, background, {
      start: () => owner.cameraStart(),
      change: (camera) => owner.cameraChange(camera),
      end: () => owner.cameraEnd(),
    });
    runtime.current = scene;
    owner.configure({
      context: () => {
        const rect = node.getBoundingClientRect();
        return {
          generation: propsRef.current.presentation.id,
          view: live.current,
          viewport: viewportValue.current,
          offset: { left: rect.left, top: rect.top },
          element: node,
        };
      },
      pose: poseFor,
      grabPoint: (id, point) => {
        const local = scene.hitPaper(id, point);
        const shape = shapeFor(id);
        return local
          ? paperToWorld(
              local,
              poseFor(live.current, id),
              shape.width,
              shape.height,
            )
          : null;
      },
      paint,
      checkpoint,
      settled: () => setMeasureEpoch((epoch) => epoch + 1),
      stopPresentation,
      stopCameraInput: () => scene.cancelCameraInput(),
      cameraSnapshot: () => scene.cameraSnapshot(),
      setCameraEnabled: (enabled) => scene.setControlsEnabled(enabled),
      wheelCamera: (dx, dy, dolly, point) =>
        scene.wheelCamera(dx, dy, dolly, point),
    });
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.altKey || event.target === background)
        owner.wheel(event);
    };
    const blur = () => owner.finish();
    node.addEventListener("wheel", wheel, { passive: false, capture: true });
    window.addEventListener("blur", blur);
    const resize = () => {
      const rect = node.getBoundingClientRect(),
        size = {
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
        };
      viewportValue.current = size;
      scene.resize(size);
      setViewport(size);
      invalidate();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => {
      observer.disconnect();
      node.removeEventListener("wheel", wheel, true);
      window.removeEventListener("blur", blur);
      owner.dispose();
      scene.dispose();
      runtime.current = null;
    };
  }, [paint, poseFor, invalidate, shapeFor, checkpoint, stopPresentation]);
  useLayoutEffect(() => {
    stopPresentation();
    interaction.current.synchronize({
      ...live.current,
      focus: props.reading.primary,
    });
    const scene = runtime.current;
    if (!scene) return;
    const from = live.current;
    const fromGeometry = displayedGeometry.current;
    const target =
      props.presentation.kind === "restore"
        ? { ...arrangement.view, camera: props.view.camera }
        : arrangement.view;
    const apply = (
      view: SpaceView,
      shapes: ReadonlyMap<SurfaceInstanceId, PaperGeometry>,
    ) => {
      displayedGeometry.current = shapes;
      const changed = scene.setPapers(
        propsRef.current.surfaces.map((surface) => ({
          surfaceId: surface.surfaceId,
          geometry: shapeFor(surface.surfaceId),
          pose: poseFor(view, surface.surfaceId),
        })),
      );
      nodes.current = scene.paperElements;
      if (changed) setPortalElements(new Map(scene.paperElements));
      paint(view);
    };
    const finish = () => {
      transition.current = null;
      apply(target, arrangement.geometry);
      invalidate();
      checkpoint({ generation: props.presentation.id, view: target });
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const start = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - start) / 280);
      if (progress === 1) {
        finish();
        return;
      }
      const current = interpolateReadingFrame(
        from,
        target,
        fromGeometry,
        arrangement.geometry,
        progress,
      );
      apply(current.view, current.geometry);
      transition.current = requestAnimationFrame(frame);
    };
    transition.current = requestAnimationFrame(frame);
    return stopPresentation;
    // Saved camera and placements are read only when this presentation starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    arrangement,
    paint,
    poseFor,
    shapeFor,
    invalidate,
    checkpoint,
    stopPresentation,
  ]);
  useLayoutEffect(() => {
    const scene = runtime.current;
    if (!scene) return;
    const changed = scene.setPapers(
      props.surfaces.map((surface) => ({
        surfaceId: surface.surfaceId,
        geometry: shapeFor(surface.surfaceId),
        pose: poseFor(live.current, surface.surfaceId),
      })),
    );
    nodes.current = scene.paperElements;
    if (changed) {
      setPortalElements(new Map(scene.paperElements));
      invalidate();
    }
  }, [props.surfaces, shapeFor, poseFor, invalidate]);
  useEffect(() => {
    const fonts = document.fonts,
      changed = () => invalidate();
    const selection = () => {
      const selected = window.getSelection(),
        next = new Set<SurfaceInstanceId>();
      if (selected && !selected.isCollapsed)
        for (const node of [selected.anchorNode, selected.focusNode]) {
          const element = node instanceof Element ? node : node?.parentElement;
          const paper = element?.closest<HTMLElement>("[data-surface-key]");
          if (paper && viewportRef.current?.contains(paper))
            next.add(paper.dataset.surfaceKey as SurfaceInstanceId);
        }
      if ([...next].join() !== [...pinned.current].join()) {
        pinned.current = next;
        setMeasureEpoch((epoch) => epoch + 1);
      }
    };
    fonts.addEventListener("loadingdone", changed);
    document.addEventListener("selectionchange", selection);
    return () => {
      fonts.removeEventListener("loadingdone", changed);
      document.removeEventListener("selectionchange", selection);
    };
  }, [invalidate]);
  useImperativeHandle(
    props.controllerRef,
    () => ({
      cancelInput: () => {
        interaction.current.cancel();
      },
      measure: invalidate,
    }),
    [invalidate],
  );
  const restored = useRef(new Map<SurfaceInstanceId, string>());
  useLayoutEffect(() => {
    const scene = runtime.current,
      owner = geometry.current;
    if (!scene || !portalElements.size || transition.current !== null) return;
    for (const surface of props.surfaces)
      owner.setSurfaceContext(
        surface.surfaceId,
        JSON.stringify([
          desiredIds.has(surface.surfaceId),
          surface.position.documentId,
          surface.position.revisionId,
        ]),
      );
    for (const surface of loaded) {
      const required = [...(anchors.current.get(surface.surfaceId) ?? [])];
      if (surface.position.focus) required.push(surface.position.focus);
      for (const binding of props.bindings)
        for (const endpoint of [binding.from, binding.to])
          if (endpoint.surfaceId === surface.surfaceId)
            required.push(endpoint.anchor);
      if (
        required.some((anchor) => !owner.hasAnchor(surface.surfaceId, anchor))
      )
        owner.dirty = true;
    }
    for (const id of restored.current.keys())
      if (!loaded.some((surface) => surface.surfaceId === id))
        restored.current.delete(id);
    const measure = owner.dirty,
      restore = measure
        ? owner.measureLayout(scene.measurementRoot, nodes.current)
        : () => {};
    const bands: SceneBand[] = [],
      markers = new Map<SurfaceInstanceId, PaperProxy[]>();
    try {
      for (const surface of loaded) {
        const scroll = nodes.current
          .get(surface.surfaceId)
          ?.querySelector<HTMLElement>("[data-document-scroll]");
        if (!scroll) continue;
        const key = `${surface.document.revisionId}:${arrangementKey}`;
        if (restored.current.get(surface.surfaceId) !== key) {
          scroll.scrollTop = surface.position.scrollTop;
          const anchor = surface.position.focus;
          if (
            anchor &&
            props.presentation.kind === "align-ranges" &&
            props.presentation.surfaces.includes(surface.surfaceId)
          ) {
            const resolved = owner.resolveAnchor(
              surface.surfaceId,
              anchor,
              passages.current.get(surface.surfaceId),
              scroll,
              measure,
            );
            if (resolved?.fragments.length)
              scroll.scrollTop = rangeScrollTarget(
                Math.min(...resolved.fragments.map((r) => r.top)),
                Math.max(...resolved.fragments.map((r) => r.bottom)),
                resolved.coverage === "complete",
                scroll.clientHeight,
                scroll.scrollHeight - scroll.clientHeight,
              );
          }
          restored.current.set(surface.surfaceId, key);
        }
        for (const anchor of anchors.current.get(surface.surfaceId) ?? [])
          if (anchor.revisionId === surface.position.revisionId)
            owner.resolveAnchor(
              surface.surfaceId,
              anchor,
              passages.current.get(surface.surfaceId),
              scroll,
              measure,
            );
      }
      const byId = new Map(
        props.surfaces.map((surface) => [surface.surfaceId, surface]),
      );
      const bindings = new Map(
        props.bindings.map((binding) => [binding.connectionId, binding]),
      );
      for (const connection of props.connections) {
        const binding = bindings.get(connection.id);
        if (!binding) continue;
        const mouths = (["from", "to"] as const).map((endpoint) => {
          const bound = binding[endpoint],
            opposite = binding[endpoint === "from" ? "to" : "from"];
          const surface = byId.get(bound.surfaceId),
            other = byId.get(opposite.surfaceId),
            declared = connection[endpoint],
            anchor = bound.anchor;
          if (
            !surface ||
            !other ||
            anchor.revisionId !== surface.position.revisionId ||
            declared.documentId !== surface.position.documentId ||
            anchor.revisionId !== declared.revisionId ||
            anchor.start !== declared.start ||
            anchor.end !== declared.end
          )
            return null;
          const id = surface.surfaceId,
            pose = poseFor(live.current, id),
            otherPose = poseFor(live.current, other.surfaceId);
          const direction = toThreeWorld(otherPose.position)
            .sub(toThreeWorld(pose.position))
            .applyQuaternion(toThreeQuaternion(pose.orientation).invert());
          const edge =
            Math.abs(direction.x) >= Math.abs(direction.y)
              ? direction.x >= 0
                ? "right"
                : "left"
              : direction.y <= 0
                ? "bottom"
                : "top";
          const scroll = nodes.current
            .get(id)
            ?.querySelector<HTMLElement>("[data-document-scroll]");
          const mouth = resolvePassageMouth({
            surfaceId: id,
            anchor,
            edge,
            layout: owner.layouts.get(id),
            geometry: owner.resolveAnchor(
              id,
              anchor,
              passages.current.get(id),
              scroll,
              measure,
            ),
            scroll,
            availability:
              surface.payload !== "ready"
                ? surface.payload
                : desiredIds.has(id)
                  ? "ready"
                  : "unmounted",
          });
          if (mouth.precision !== "exact") {
            const list = markers.get(id) ?? [];
            list.push({
              key: `${connection.id}:${endpoint}`,
              mouth,
              color: relationStyle(connection.relation)["--relation-signal"],
            });
            markers.set(id, list);
          }
          return mouth;
        });
        if (mouths[0] && mouths[1])
          bands.push({
            id: connection.id,
            from: mouths[0],
            to: mouths[1],
            color: relationStyle(connection.relation)["--relation-signal"],
            opacity: props.selectedConnectionId
              ? connection.id === props.selectedConnectionId
                ? 0.42
                : 0.045
              : mouths.every((mouth) => mouth?.precision === "exact")
                ? 0.24
                : 0.09,
          });
      }
    } finally {
      restore();
      owner.dirty = false;
    }
    scene.setBands(bands);
    setProxies(markers);
  }, [
    loaded,
    desiredIds,
    props.surfaces,
    props.connections,
    props.selectedConnectionId,
    props.bindings,
    props.presentation,
    measureEpoch,
    portalElements,
    poseFor,
  ]);
  const scroll = useCallback(
    (id: SurfaceInstanceId, top: number) => {
      if (transition.current !== null) return;
      propsRef.current.onScroll(id, top, propsRef.current.presentation.id);
      setMeasureEpoch((epoch) => epoch + 1);
    },
    [setMeasureEpoch],
  );
  const pointerStart = useRef<{
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const framePapers = (all: boolean) => {
    interaction.current.finish();
    stopPresentation();
    const value = live.current;
    const ids =
      all || !value.focus
        ? props.surfaces.map((surface) => surface.surfaceId)
        : [value.focus];
    if (!ids.length) return;
    const camera = focusCamera(
      value.camera,
      poseFor(value, value.focus ?? ids[0]),
    );
    const view = {
      ...value,
      camera: fitCameraToPapers(
        camera,
        ids.map((id) => ({ pose: poseFor(value, id), ...shapeFor(id) })),
        viewport,
      ),
    };
    paint(view);
    checkpoint({ generation: props.presentation.id, view });
    setMeasureEpoch((epoch) => epoch + 1);
  };
  return (
    <div
      ref={viewportRef}
      className="spatial-scene"
      data-hit-role="stage"
      data-reading-layout={arrangement.paired}
      style={
        {
          "--reading-body-font-size": `${viewport.width <= 620 ? 28 : 24}px`,
        } as React.CSSProperties
      }
      aria-label="三维文档空间"
      role="region"
      tabIndex={0}
      onPointerDownCapture={(event) => {
        stopPresentation();
        interaction.current.beginPointer();
        pointerStart.current = {
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
        const target = event.target as Element;
        if (
          target !== backgroundRef.current &&
          !target.closest(
            "button,a,input,textarea,select,summary,[contenteditable]",
          ) &&
          (event.button === 2 ||
            (event.button === 0 &&
              event.shiftKey &&
              !target.closest("[data-paper-grip]")))
        ) {
          event.preventDefault();
          event.stopPropagation();
          runtime.current?.beginCameraPointer(event.nativeEvent);
        }
      }}
      onPointerMoveCapture={(event) => {
        const start = pointerStart.current;
        if (
          start &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5
        )
          start.moved = true;
      }}
      onPointerDown={(event) => interaction.current.pointerDown(event)}
      onPointerMove={(event) => interaction.current.pointerMove(event)}
      onPointerUp={(event) => interaction.current.pointerUp(event)}
      onPointerCancelCapture={() => interaction.current.finish()}
      onLostPointerCapture={(event) =>
        interaction.current.lostPointerCapture(event)
      }
      onClickCapture={(event) => {
        const start = pointerStart.current;
        pointerStart.current = null;
        const dragged = interaction.current.consumeClick();
        if (event.detail === 0) return;
        if (
          dragged ||
          start?.moved ||
          (start &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5)
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (
          !start ||
          event.defaultPrevented ||
          window.getSelection()?.isCollapsed === false
        )
          return;
        if (
          (event.target as Element).closest(
            "button,a,input,textarea,[data-paper-grip]",
          )
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        const hit = runtime.current?.pickBand(
          screenPoint(event.clientX - rect.left, event.clientY - rect.top),
        );
        if (!hit) return;
        const binding = props.bindings.find(
          (item) => item.connectionId === hit.connectionId,
        );
        if (!binding) return;
        event.preventDefault();
        event.stopPropagation();
        props.onFollow({
          connectionId: hit.connectionId,
          origin: {
            kind: "surface",
            surfaceId: binding[hit.endpoint].surfaceId,
            endpoint: hit.endpoint,
          },
        });
      }}
      onKeyDown={(event) => {
        if (interaction.current.keyDown(event)) return;
        if (event.key === "Home" && event.target === event.currentTarget) {
          event.preventDefault();
          framePapers(false);
          return;
        }
      }}
    >
      <div
        ref={backgroundRef}
        className="spatial-scene-background"
        data-scene-background
      />
      <div ref={rendererHostRef} className="spatial-renderers" />
      {props.surfaces.map((surface) => {
        const element = portalElements.get(surface.surfaceId);
        return element ? (
          <ScenePaper
            key={surface.surfaceId}
            surface={surface}
            readingRole={arrangement.roles.get(surface.surfaceId) ?? "context"}
            readingActive={!!props.reading.primary}
            intrinsicHeight={
              arrangement.geometry.get(surface.surfaceId)?.height ??
              shapeFor(surface.surfaceId).height
            }
            contextLabel={
              surface.surfaceId === props.reading.companion
                ? "关联原文 · 点击继续阅读"
                : props.readingTrail.includes(surface.surfaceId)
                  ? "阅读来处 · 点击返回"
                  : "空间中的文档 · 点击阅读"
            }
            resident={desiredIds.has(surface.surfaceId)}
            element={element}
            proxies={proxies.get(surface.surfaceId) ?? []}
            onRetry={props.onRetrySurface}
            registerPassage={registerPassage}
            invalidate={invalidate}
            registerAnchors={registerAnchors}
            hitTestAnchor={hitTestAnchor}
            onScroll={scroll}
            onFocus={focus}
            renderDocument={props.renderDocument}
            renderDocumentMenu={props.renderDocumentMenu}
          />
        ) : null;
      })}
      <nav className="spatial-navigation" aria-label="空间导航">
        <button type="button" onClick={() => framePapers(false)}>
          定位文档
        </button>
        <button type="button" onClick={() => framePapers(true)}>
          查看全部
        </button>
      </nav>
      <details className="spatial-help">
        <summary>操作说明</summary>
        <p>
          拖动空白处平移；Shift 或右键拖动环顾；捏合或 Alt
          滚轮缩放。正文内滚动阅读、拖动选择文字；拖动标题或纸边移动文档，按住
          Shift 调整远近。按 Escape
          取消当前操作。触屏可单指平移空白处，双指缩放。
        </p>
      </details>
      {props.relationNavigation.total > 0 && (
        <nav className="spatial-relations" aria-label="关联导航">
          <button
            type="button"
            aria-label="上一个关联"
            disabled={
              !props.relationNavigation.canPrevious ||
              props.relationNavigation.loading
            }
            onClick={() => props.onStepConnection(-1)}
          >
            ←
          </button>
          <span aria-live="polite">
            关联 {props.relationNavigation.ordinal ?? "—"} /{" "}
            {props.relationNavigation.total}
          </span>
          <button
            type="button"
            aria-label="下一个关联"
            disabled={
              !props.relationNavigation.canNext ||
              props.relationNavigation.loading
            }
            onClick={() => props.onStepConnection(1)}
          >
            →
          </button>
        </nav>
      )}
    </div>
  );
}
