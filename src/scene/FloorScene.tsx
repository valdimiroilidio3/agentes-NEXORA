'use client';

import { memo, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Building, Floor } from '@/domain/types';
import {
  buildCeilingLights,
  buildDoors,
  buildFloorBase,
  buildRoomCeiling,
  buildWalls,
} from './architecture';
import { buildEndFacade, buildFloorFacade } from './facade';
import { SceneBoxes } from './SceneBoxes';
import { FurnitureItem } from './Furniture';
import { LabelSprite } from './Labels';
import { summariseRoom } from '@/domain/selectors';
import type { OperationsState } from '@/domain/operations';
import { materials, unitBox } from './materials';
import type { ViewMode } from '@/domain/types';

/**
 * Static architectural shell of one floor. Memoised on the building/floor
 * identity so operational updates never rebuild wall and furniture geometry.
 */
export const FloorShell = memo(function FloorShell({
  building,
  floor,
  showFacade,
  showInterior,
  hiddenFacadeSide = null,
}: {
  building: Building;
  floor: Floor;
  showFacade: boolean;
  /** Cutaway: the façade between the camera and the interior is removed. */
  hiddenFacadeSide?: 'north' | 'south' | null;
  /**
   * Interior detail is a level-of-detail switch: furniture and ceiling
   * fixtures only render when the interior is actually revealed (cutaway,
   * floor or room view). This keeps the overview and exterior views cheap.
   */
  showInterior: boolean;
}) {
  const { base, walls, doors, lights, facade } = useMemo(
    () => ({
      base: buildFloorBase(building, floor),
      walls: buildWalls(building, floor),
      doors: buildDoors(floor),
      lights: showInterior ? buildCeilingLights(floor) : [],
      facade: showFacade
        ? [
            ...buildFloorFacade(building, floor, {
              hideNorth: hiddenFacadeSide === 'north',
              hideSouth: hiddenFacadeSide === 'south',
            }),
            ...buildEndFacade(building, floor),
          ]
        : [],
    }),
    [building, floor, showFacade, showInterior, hiddenFacadeSide],
  );

  const furniture = useMemo(
    () => (showInterior ? floor.rooms.flatMap((room) => room.furniture) : []),
    [floor, showInterior],
  );

  return (
    <group>
      <SceneBoxes specs={base} />
      <SceneBoxes specs={walls} />
      <SceneBoxes specs={doors} />
      <SceneBoxes specs={lights} />
      {showFacade && <SceneBoxes specs={facade} />}
      {furniture.map((item) => (
        <FurnitureItem key={item.id} item={item} />
      ))}
    </group>
  );
});

const statusStripMaterial = {
  active: materials.statusActive,
  error: materials.statusError,
  waiting: materials.statusWaiting,
} as const;

export interface FloorLiveLayerProps {
  readonly building: Building;
  readonly floor: Floor;
  readonly ops: OperationsState;
  readonly viewMode: ViewMode;
  readonly selectedRoomId: string | null;
  readonly selectedAgentId: string | null;
  readonly hoveredRoomId: string | null;
  /** False in exterior/overview: interiors are hidden behind the façade. */
  readonly showInterior?: boolean;
  readonly onSelectRoom: (roomId: string | null) => void;
  readonly onHoverRoom: (roomId: string | null) => void;
  readonly onSelectAgent: (agentId: string | null) => void;
}

/** Everything that changes with operational state: highlights, agents, labels. */
export function FloorLiveLayer({
  building,
  floor,
  ops,
  viewMode,
  selectedRoomId,
  selectedAgentId,
  hoveredRoomId,
  showInterior = true,
  onSelectRoom,
  onHoverRoom,
  onSelectAgent,
}: FloorLiveLayerProps) {

  const summaries = useMemo(
    () => new Map(floor.rooms.map((room) => [room.id, summariseRoom(ops, room.id)])),
    [ops, floor.rooms],
  );

  const showLabels = viewMode === 'floor' || viewMode === 'room';

  return (
    <group>
      {floor.rooms.map((room) => {
        const selected = room.id === selectedRoomId;
        const hovered = room.id === hoveredRoomId && !selected;
        const summary = summaries.get(room.id);
        const corridorZ = room.rect.z < 0 ? room.rect.z + room.rect.depth / 2 : room.rect.z - room.rect.depth / 2;
        const stripMaterial = summary?.hasError
          ? statusStripMaterial.error
          : summary?.hasActivity
            ? statusStripMaterial.active
            : summary && summary.agents.some((agent) => agent.status === 'WAITING')
              ? statusStripMaterial.waiting
              : null;

        const handle = (event: ThreeEvent<MouseEvent>) => {
          if (event.delta > 5) return;
          event.stopPropagation();
          onSelectRoom(room.id);
        };

        return (
          <group key={room.id}>
            <mesh
              position={[room.rect.x, floor.elevation + 0.04, room.rect.z]}
              onPointerOver={(event) => {
                event.stopPropagation();
                onHoverRoom(room.id);
              }}
              onPointerOut={() => onHoverRoom(null)}
              onClick={handle}
            >
              <boxGeometry args={[room.rect.width, 0.08, room.rect.depth]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>

            {(selected || hovered) && (
              <mesh
                geometry={unitBox}
                material={selected ? materials.selection : materials.selectionSoft}
                position={[room.rect.x, floor.elevation + 0.075, room.rect.z]}
                scale={[room.rect.width - 0.12, 0.02, room.rect.depth - 0.12]}
              />
            )}

            {stripMaterial && (
              <mesh
                geometry={unitBox}
                material={stripMaterial}
                position={[room.rect.x, floor.elevation + 0.06, corridorZ - (room.rect.z < 0 ? 0.12 : -0.12)]}
                scale={[room.rect.width * 0.55, 0.03, 0.08]}
              />
            )}

            {showLabels && (
              <LabelSprite
                text={room.name}
                sub={`${room.code} · ${room.template.replace(/-/g, ' ')}`}
                position={[room.rect.x, floor.elevation + room.ceilingHeight + 0.55, room.rect.z]}
                accent={selected ? '#54d6e6' : undefined}
                scale={selected ? 1.12 : 0.92}
              />
            )}

            {selected && viewMode === 'room' && (
              <SceneBoxes specs={buildRoomCeiling(room, floor)} />
            )}
          </group>
        );
      })}
    </group>
  );
}

/** Floor-level ambient light fitting; two per floor keeps the scene cheap. */
export function FloorLights({ building, floor }: { building: Building; floor: Floor }) {
  const y = floor.elevation + floor.ceilingHeight - 0.3;
  const offset = building.footprint.width * 0.22;
  return (
    <>
      <pointLight position={[-offset, y, 0]} color="#ffe6c4" intensity={18} distance={20} decay={2} />
      <pointLight position={[offset, y, 0]} color="#ffe6c4" intensity={18} distance={20} decay={2} />
      <pointLight position={[0, y, 0]} color="#dff1ff" intensity={8} distance={14} decay={2} />
    </>
  );
}
