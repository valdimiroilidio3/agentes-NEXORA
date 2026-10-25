'use client';

import { Component, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useOfficeStore } from '@/store/officeStore';
import type { Building, ViewMode } from '@/domain/types';
import type { OperationsState } from '@/domain/operations';
import { buildFacadeFins, buildRoof, buildSite, entranceXFor } from './facade';
import { SceneBoxes } from './SceneBoxes';
import { FloorLights, FloorLiveLayer, FloorShell } from './FloorScene';
import { computeCameraPose, cameraLimits, type CameraPose } from './camera';
import { sceneLayers, visibleFloors } from './visibility';
import { FacadeSign } from './Labels';

/* ------------------------------------------------------------------ */
/* Environment + lighting                                              */
/* ------------------------------------------------------------------ */

function SceneEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const environment = new RoomEnvironment();
    const target = pmrem.fromScene(environment, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.32;
    return () => {
      target.dispose();
      environment.dispose();
      pmrem.dispose();
      scene.environment = null;
    };
  }, [gl, scene]);
  return null;
}

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.32} />
      <hemisphereLight args={['#c9ddf2', '#0e1216', 0.55]} />
      <directionalLight
        position={[34, 52, -38]}
        intensity={2.1}
        color="#fff4e2"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-46}
        shadow-camera-right={46}
        shadow-camera-top={52}
        shadow-camera-bottom={-46}
        shadow-camera-near={1}
        shadow-camera-far={180}
      />
      <directionalLight position={[-30, 24, 30]} intensity={0.45} color="#9fc4dd" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function CameraRig({ pose, focusToken, building }: { pose: CameraPose; focusToken: number; building: Building }) {
  const { camera, gl } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const animation = useRef({
    active: false,
    t: 0,
    from: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
  });

  useEffect(() => {
    const instance = new OrbitControls(camera, gl.domElement);
    instance.enableDamping = true;
    instance.dampingFactor = 0.075;
    instance.rotateSpeed = 0.65;
    instance.zoomSpeed = 0.8;
    instance.panSpeed = 0.7;
    instance.screenSpacePanning = false;
    const limits = cameraLimits(building);
    instance.minDistance = limits.minDistance;
    instance.maxDistance = limits.maxDistance;
    instance.maxPolarAngle = limits.maxPolarAngle;
    instance.minPolarAngle = limits.minPolarAngle;
    controls.current = instance;
    return () => {
      instance.dispose();
      controls.current = null;
    };
  }, [camera, gl, building]);

  const targetPosition = useMemo(() => new THREE.Vector3(...pose.position), [pose.position]);
  const targetLook = useMemo(() => new THREE.Vector3(...pose.target), [pose.target]);

  useEffect(() => {
    const instance = controls.current;
    if (!instance) return;
    animation.current = {
      active: true,
      t: 0,
      from: camera.position.clone(),
      fromTarget: instance.target.clone(),
    };
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.fov = pose.fov;
    perspective.updateProjectionMatrix();
  }, [focusToken, camera, pose.fov]);

  useEffect(() => {
    const instance = controls.current;
    if (!instance) return;
    const interrupt = () => {
      animation.current.active = false;
    };
    instance.addEventListener('start', interrupt);
    return () => instance.removeEventListener('start', interrupt);
  }, []);

  useFrame((_, delta) => {
    const instance = controls.current;
    if (!instance) return;
    const anim = animation.current;
    if (anim.active) {
      anim.t = Math.min(1, anim.t + delta / 0.95);
      const eased = easeInOutCubic(anim.t);
      camera.position.lerpVectors(anim.from, targetPosition, eased);
      instance.target.lerpVectors(anim.fromTarget, targetLook, eased);
      if (anim.t >= 1) anim.active = false;
    }
    instance.update();
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* HUD probe                                                           */
/* ------------------------------------------------------------------ */

function PerfProbe({ target }: { target: RefObject<HTMLSpanElement | null> }) {
  const frames = useRef(0);
  const last = useRef(typeof performance === 'undefined' ? 0 : performance.now());
  useFrame(() => {
    frames.current += 1;
    const now = performance.now();
    const elapsed = now - last.current;
    if (elapsed >= 1000) {
      const fps = Math.round((frames.current * 1000) / elapsed);
      if (target.current) target.current.textContent = String(fps);
      frames.current = 0;
      last.current = now;
    }
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Error boundary for WebGL / render failures                          */
/* ------------------------------------------------------------------ */

class SceneErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export interface SceneWorldProps {
  readonly building: Building;
  readonly ops: OperationsState;
  readonly viewMode: ViewMode;
  readonly isolatedFloorId: string | null;
  readonly hiddenFloorIds: readonly string[];
  readonly cutaway: boolean;
  readonly selectedRoomId: string | null;
  readonly selectedAgentId: string | null;
  readonly hoveredRoomId: string | null;
  readonly onSelectRoom: (roomId: string | null) => void;
  readonly onHoverRoom: (roomId: string | null) => void;
  readonly onSelectAgent: (agentId: string | null) => void;
}

/**
 * Pure scene graph: no store access, no camera controllers and no WebGL
 * environment, so it can be rendered and asserted in tests.
 */
export function SceneWorld({
  building,
  ops,
  viewMode,
  isolatedFloorId,
  hiddenFloorIds,
  cutaway,
  selectedRoomId,
  selectedAgentId,
  hoveredRoomId,
  onSelectRoom,
  onHoverRoom,
  onSelectAgent,
}: SceneWorldProps) {
  const extras = useMemo(
    () => ({ site: buildSite(building), roof: buildRoof(building), fins: buildFacadeFins(building) }),
    [building],
  );
  const floorsToRender = visibleFloors(building, { viewMode, isolatedFloorId, hiddenFloorIds, cutaway });
  const layers = sceneLayers({ viewMode, isolatedFloorId, hiddenFloorIds, cutaway });
  // Interiors are only worth drawing when the user can actually see them.
  const showInterior =
    viewMode === 'floor' || viewMode === 'room' || (viewMode === 'building' && cutaway);
  const entranceX = entranceXFor(building);

  return (
    <>
      <color attach="background" args={['#070a0d']} />
      <fog attach="fog" args={['#070a0d', 95, 260]} />
      <Lighting />

      <SceneBoxes specs={extras.site} />
      {layers.showRoof && <SceneBoxes specs={extras.roof} />}
      {layers.showFins && <SceneBoxes specs={extras.fins} />}

      {layers.showNorthFacade && (
        <FacadeSign x={entranceX} y={5.6} z={-building.footprint.depth / 2 - 0.36} />
      )}

      {floorsToRender.map((floor) => (
        <group key={floor.id}>
          <FloorShell
            building={building}
            floor={floor}
            showFacade={layers.showFacade}
            showInterior={showInterior}
            hiddenFacadeSide={layers.hiddenFacadeSide}
          />
          <FloorLiveLayer
            building={building}
            floor={floor}
            ops={ops}
            viewMode={viewMode}
            selectedRoomId={selectedRoomId}
            selectedAgentId={selectedAgentId}
            hoveredRoomId={hoveredRoomId}
            showInterior={showInterior}
            onSelectRoom={onSelectRoom}
            onHoverRoom={onHoverRoom}
            onSelectAgent={onSelectAgent}
          />
          {showInterior && <FloorLights building={building} floor={floor} />}
        </group>
      ))}
    </>
  );
}

function SceneContent({ fpsTarget }: { fpsTarget: RefObject<HTMLSpanElement | null> }) {
  const building = useOfficeStore((state) => state.building);
  const ops = useOfficeStore((state) => state.ops);
  const viewMode = useOfficeStore((state) => state.viewMode);
  const isolatedFloorId = useOfficeStore((state) => state.isolatedFloorId);
  const hiddenFloorIds = useOfficeStore((state) => state.hiddenFloorIds);
  const cutaway = useOfficeStore((state) => state.cutaway);
  const selectedRoomId = useOfficeStore((state) => state.selectedRoomId);
  const selectedAgentId = useOfficeStore((state) => state.selectedAgentId);
  const hoveredRoomId = useOfficeStore((state) => state.hoveredRoomId);
  const focusToken = useOfficeStore((state) => state.focusToken);
  const selectRoom = useOfficeStore((state) => state.selectRoom);
  const hoverRoom = useOfficeStore((state) => state.hoverRoom);
  const selectAgent = useOfficeStore((state) => state.selectAgent);

  const pose = useMemo(
    () =>
      building
        ? computeCameraPose(building, { viewMode, selectedRoomId, isolatedFloorId })
        : ({ position: [40, 30, -46], target: [0, 8, 0], fov: 38 } as CameraPose),
    [building, viewMode, selectedRoomId, isolatedFloorId],
  );

  if (!building) return null;

  return (
    <>
      <SceneEnvironment />
      <PerfProbe target={fpsTarget} />
      <SceneWorld
        building={building}
        ops={ops}
        viewMode={viewMode}
        isolatedFloorId={isolatedFloorId}
        hiddenFloorIds={hiddenFloorIds}
        cutaway={cutaway}
        selectedRoomId={selectedRoomId}
        selectedAgentId={selectedAgentId}
        hoveredRoomId={hoveredRoomId}
        onSelectRoom={selectRoom}
        onHoverRoom={hoverRoom}
        onSelectAgent={selectAgent}
      />
      <CameraRig pose={pose} focusToken={focusToken} building={building} />
    </>
  );
}

export default function OfficeScene() {
  const fpsRef = useRef<HTMLSpanElement>(null);
  const viewMode = useOfficeStore((state) => state.viewMode);
  const selectedRoomId = useOfficeStore((state) => state.selectedRoomId);

  return (
    <div className="scene-wrap">
      <SceneErrorBoundary
        fallback={
          <div className="scene-fallback" role="alert">
            <h2>3D view unavailable</h2>
            <p>
              The WebGL context could not be created. The building is still fully navigable through the floor and room
              lists on the left; all operational data remains available.
            </p>
          </div>
        }
      >
        <Canvas
          shadows
          dpr={[1, 1.75]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          camera={{ fov: 38, near: 0.1, far: 400, position: [46, 32, -52] }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.0;
          }}
        >
          <SceneContent fpsTarget={fpsRef} />
        </Canvas>
      </SceneErrorBoundary>
      <div className="scene-readout" aria-hidden>
        <span ref={fpsRef}>–</span> fps
        <span className="dot" />
        {viewMode}
        {selectedRoomId ? <span className="dot" /> : null}
        {selectedRoomId ?? ''}
      </div>
    </div>
  );
}
