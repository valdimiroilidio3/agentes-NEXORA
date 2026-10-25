'use client';

import type { ReactNode } from 'react';
import type { FurnitureKind, FurniturePlacement } from '@/domain/types';
import {
  materials,
  unitBox,
  unitCylinder,
  unitCylinderLow,
  unitSphere,
  type MaterialKey,
} from './materials';

interface BoxProps {
  readonly pos: [number, number, number];
  readonly size: [number, number, number];
  readonly mat: MaterialKey;
  readonly rotY?: number;
  readonly shadow?: boolean;
}

function B({ pos, size, mat, rotY = 0, shadow = false }: BoxProps) {
  return (
    <mesh
      geometry={unitBox}
      material={materials[mat]}
      position={pos}
      scale={size}
      rotation-y={rotY}
      castShadow={shadow}
      receiveShadow
    />
  );
}

function Cyl({
  pos,
  size,
  mat,
  low = false,
}: {
  pos: [number, number, number];
  size: [number, number, number];
  mat: MaterialKey;
  low?: boolean;
}) {
  return (
    <mesh
      geometry={low ? unitCylinderLow : unitCylinder}
      material={materials[mat]}
      position={pos}
      scale={size}
      castShadow
      receiveShadow
    />
  );
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

function Desk({ scale = 1 }: { scale?: number }) {
  const w = 1.6 * scale;
  const d = 0.8 * scale;
  const h = 0.74;
  return (
    <group>
      <B pos={[0, h, 0]} size={[w, 0.06, d]} mat="wood" shadow />
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <B
            key={`${sx}${sz}`}
            pos={[(sx * (w - 0.12)) / 2, h / 2, (sz * (d - 0.1)) / 2]}
            size={[0.055, h, 0.055]}
            mat="darkMetal"
          />
        )),
      )}
      <B pos={[0, h - 0.18, -d / 2 + 0.06]} size={[w - 0.2, 0.3, 0.03]} mat="darkMetal" />
    </group>
  );
}

function Chair({ scale = 1 }: { scale?: number }) {
  const w = 0.52 * scale;
  return (
    <group>
      <B pos={[0, 0.45, 0]} size={[w, 0.08, w]} mat="fabric" />
      <B pos={[0, 0.76, -w / 2 + 0.03]} size={[w, 0.55, 0.06]} mat="fabric" shadow />
      <Cyl pos={[0, 0.22, 0]} size={[0.08, 0.44, 0.08]} mat="darkMetal" />
      <Cyl pos={[0, 0.03, 0]} size={[w, 0.06, w]} mat="darkMetal" low />
    </group>
  );
}

function Monitor() {
  return (
    <group>
      <B pos={[0, 0.86, 0]} size={[0.24, 0.18, 0.12]} mat="darkMetal" />
      <B pos={[0, 1.22, 0]} size={[1.05, 0.55, 0.035]} mat="screen" />
      <B pos={[0, 1.22, -0.03]} size={[1.12, 0.62, 0.02]} mat="black" />
    </group>
  );
}

function Shelf({ scale = 1 }: { scale?: number }) {
  const w = 1.2 * scale;
  return (
    <group>
      <B pos={[0, 0.95, 0]} size={[w, 1.9, 0.08]} mat="woodDark" shadow />
      {[0.35, 0.85, 1.35].map((y) => (
        <B key={y} pos={[0, y, 0]} size={[w, 0.04, 0.42]} mat="wood" />
      ))}
      <B pos={[-w / 2, 0.95, 0.2]} size={[0.06, 1.9, 0.04]} mat="metal" />
      <B pos={[w / 2, 0.95, 0.2]} size={[0.06, 1.9, 0.04]} mat="metal" />
    </group>
  );
}

function Sofa({ scale = 1 }: { scale?: number }) {
  const w = 2.1 * scale;
  return (
    <group>
      <B pos={[0, 0.32, 0]} size={[w, 0.34, 0.9]} mat="fabric" shadow />
      <B pos={[0, 0.66, -0.32]} size={[w, 0.46, 0.24]} mat="fabric" shadow />
      <B pos={[-w / 2 + 0.06, 0.52, 0]} size={[0.14, 0.4, 0.9]} mat="fabric" />
      <B pos={[w / 2 - 0.06, 0.52, 0]} size={[0.14, 0.4, 0.9]} mat="fabric" />
      {[-0.55, 0.55].map((x) => (
        <B key={x} pos={[x, 0.52, 0.08]} size={[w / 2.4, 0.12, 0.7]} mat="fabricLight" />
      ))}
    </group>
  );
}

function CoffeeTable() {
  return (
    <group>
      <B pos={[0, 0.4, 0]} size={[1.1, 0.06, 0.6]} mat="wood" shadow />
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <B
            key={`${sx}${sz}`}
            pos={[(sx * 0.95) / 2, 0.2, (sz * 0.45) / 2]}
            size={[0.05, 0.4, 0.05]}
            mat="darkMetal"
          />
        )),
      )}
    </group>
  );
}

function MeetingTable({ scale = 1 }: { scale?: number }) {
  const w = 3.2 * scale;
  const d = 1.4 * scale;
  return (
    <group>
      <B pos={[0, 0.74, 0]} size={[w, 0.07, d]} mat="wood" shadow />
      <B pos={[0, 0.42, 0]} size={[w * 0.6, 0.06, d * 0.28]} mat="darkMetal" />
      <Cyl pos={[-w * 0.28, 0.35, 0]} size={[0.16, 0.7, 0.16]} mat="darkMetal" />
      <Cyl pos={[w * 0.28, 0.35, 0]} size={[0.16, 0.7, 0.16]} mat="darkMetal" />
    </group>
  );
}

function Whiteboard({ scale = 1 }: { scale?: number }) {
  const w = 2.0 * scale;
  const h = 1.15 * scale;
  return (
    <group>
      <B pos={[0, 1.45, 0]} size={[w, h, 0.04]} mat="white" />
      <B pos={[0, 1.45, -0.03]} size={[w + 0.08, h + 0.08, 0.03]} mat="metal" />
      <B pos={[0, 0.83, 0.04]} size={[w * 0.4, 0.04, 0.1]} mat="metal" />
    </group>
  );
}

function Plant() {
  return (
    <group>
      <Cyl pos={[0, 0.22, 0]} size={[0.42, 0.44, 0.42]} mat="concreteDark" />
      <mesh
        geometry={unitSphere}
        material={materials.foliage}
        position={[0, 0.95, 0]}
        scale={[0.85, 1.1, 0.85]}
        castShadow
      />
      <mesh
        geometry={unitSphere}
        material={materials.foliage}
        position={[0.18, 1.3, 0.1]}
        scale={[0.5, 0.6, 0.5]}
        castShadow
      />
    </group>
  );
}

function Counter({ scale = 1 }: { scale?: number }) {
  const w = 2.6 * scale;
  return (
    <group>
      <B pos={[0, 0.5, 0]} size={[w, 1.0, 0.8]} mat="wood" shadow />
      <B pos={[0, 1.04, 0]} size={[w + 0.06, 0.07, 0.86]} mat="stone" />
      <B pos={[0, 0.72, 0.41]} size={[w - 0.2, 0.1, 0.03]} mat="woodDark" />
    </group>
  );
}

function Credenza({ scale = 1 }: { scale?: number }) {
  const w = 1.8 * scale;
  return (
    <group>
      <B pos={[0, 0.38, 0]} size={[w, 0.72, 0.5]} mat="wood" shadow />
      <B pos={[0, 0.76, 0]} size={[w + 0.04, 0.04, 0.54]} mat="stone" />
      <B pos={[0, 0.38, 0.26]} size={[w - 0.1, 0.02, 0.01]} mat="darkMetal" />
    </group>
  );
}

function ServerRack() {
  return (
    <group>
      <B pos={[0, 1.0, 0]} size={[0.8, 2.0, 1.1]} mat="darkMetal" shadow />
      <B pos={[0, 1.45, 0.56]} size={[0.6, 0.06, 0.02]} mat="statusActive" />
      {[0.6, 0.9, 1.2].map((y) => (
        <B key={y} pos={[0, y, 0.56]} size={[0.68, 0.03, 0.02]} mat="metal" />
      ))}
    </group>
  );
}

function Bench({ scale = 1 }: { scale?: number }) {
  const w = 2.0 * scale;
  return (
    <group>
      <B pos={[0, 0.45, 0]} size={[w, 0.08, 0.5]} mat="wood" shadow />
      {[-1, 1].map((side) => (
        <B key={side} pos={[(side * (w - 0.3)) / 2, 0.22, 0]} size={[0.08, 0.44, 0.42]} mat="metal" />
      ))}
    </group>
  );
}

function Stool() {
  return (
    <group>
      <Cyl pos={[0, 0.62, 0]} size={[0.4, 0.07, 0.4]} mat="fabric" />
      <Cyl pos={[0, 0.32, 0]} size={[0.06, 0.62, 0.06]} mat="metal" />
      <Cyl pos={[0, 0.02, 0]} size={[0.34, 0.04, 0.34]} mat="darkMetal" low />
    </group>
  );
}

function VideoWall({ scale = 1 }: { scale?: number }) {
  const w = 4.2 * scale;
  const h = 1.6 * scale;
  return (
    <group>
      <B pos={[0, 2.0, 0]} size={[w + 0.12, h + 0.12, 0.1]} mat="black" shadow />
      <B pos={[0, 2.0, 0.06]} size={[w, h, 0.02]} mat="screen" />
    </group>
  );
}

function ElevatorDoor() {
  return (
    <group>
      <B pos={[0, 1.15, 0]} size={[2.4, 2.3, 0.09]} mat="metal" shadow />
      <B pos={[0, 1.15, 0.05]} size={[0.03, 2.3, 0.02]} mat="black" />
      <B pos={[0, 2.42, 0.06]} size={[0.7, 0.22, 0.03]} mat="darkMetal" />
      <B pos={[0, 2.42, 0.08]} size={[0.6, 0.04, 0.01]} mat="statusWaiting" />
    </group>
  );
}

function Stair() {
  const steps = 12;
  const riser = 0.21;
  const tread = 0.28;
  return (
    <group>
      {Array.from({ length: steps }, (_, index) => (
        <B
          key={index}
          pos={[-0.75, index * riser + riser / 2, 1.4 - index * tread]}
          size={[2.0, riser + 0.02, tread]}
          mat="stone"
          shadow
        />
      ))}
      <B pos={[-0.75, steps * riser - 0.1, 1.4 - steps * tread - 0.6]} size={[2.0, 0.2, 1.4]} mat="stone" />
      <B
        pos={[0.32, (steps * riser) / 2 + 0.4, 1.4 - (steps * tread) / 2]}
        size={[0.05, 0.05, steps * tread + 1.2]}
        mat="metal"
      />
      {[0.2, 0.5, 0.8].map((t) => (
        <B
          key={t}
          pos={[0.32, steps * riser * t + 0.5, 1.4 - steps * tread * t]}
          size={[0.05, 1.0, 0.05]}
          mat="metal"
        />
      ))}
    </group>
  );
}

function Turnstile() {
  return (
    <group>
      <Cyl pos={[0, 0.5, 0]} size={[0.22, 1.0, 0.22]} mat="metal" />
      <B pos={[0, 0.78, 0]} size={[0.9, 0.06, 0.06]} mat="glassPartition" />
      <B pos={[0, 1.02, 0]} size={[0.16, 0.12, 0.16]} mat="statusActive" />
    </group>
  );
}

function Rug({ scale = 1 }: { scale?: number }) {
  return <B pos={[0, 0.015, 0]} size={[2.6 * scale, 0.02, 1.8 * scale]} mat="fabric" />;
}

const catalogue: Record<FurnitureKind, (props: { scale: number }) => ReactNode> = {
  desk: ({ scale }) => <Desk scale={scale} />,
  chair: ({ scale }) => <Chair scale={scale} />,
  monitor: () => <Monitor />,
  shelf: ({ scale }) => <Shelf scale={scale} />,
  sofa: ({ scale }) => <Sofa scale={scale} />,
  'coffee-table': () => <CoffeeTable />,
  'meeting-table': ({ scale }) => <MeetingTable scale={scale} />,
  whiteboard: ({ scale }) => <Whiteboard scale={scale} />,
  plant: () => <Plant />,
  counter: ({ scale }) => <Counter scale={scale} />,
  credenza: ({ scale }) => <Credenza scale={scale} />,
  'server-rack': () => <ServerRack />,
  bench: ({ scale }) => <Bench scale={scale} />,
  stool: () => <Stool />,
  'video-wall': ({ scale }) => <VideoWall scale={scale} />,
  'elevator-door': () => <ElevatorDoor />,
  stair: () => <Stair />,
  turnstile: () => <Turnstile />,
  rug: ({ scale }) => <Rug scale={scale} />,
};

export function FurnitureItem({ item }: { item: FurniturePlacement }) {
  const render = catalogue[item.kind];
  return (
    <group position={[item.position.x, 0, item.position.z]} rotation-y={item.rotationY}>
      {render({ scale: item.scale ?? 1 })}
    </group>
  );
}
