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
import { AgentCharacter, OfficeChair } from './character/AgentCharacter';
import { appearanceFor } from './character/appearance';
import { behaviourFor } from './character/behaviour';
import type { DetailLevel } from './character/parts';
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
  /** Character detail tier: full inside a floor or room, compact in cutaway. */
  readonly characterDetail?: DetailLevel;
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
  characterDetail = 'compact',
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
      {showInterior && (
        <FloorAgents
          floor={floor}
          ops={ops}
          detail={characterDetail}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
        />
      )}
    </group>
  );
}

/**
 * All occupants of one floor, drawn once per agent rather than per room so a
 * character can stand beside its desk without being re-parented.
 */
export function FloorAgents({
  floor,
  ops,
  detail,
  selectedAgentId,
  onSelectAgent,
}: {
  floor: Floor;
  ops: OperationsState;
  detail: DetailLevel;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}) {
  const tasksById = useMemo(
    () => new Map(ops.tasks.map((task) => [task.id, task])),
    [ops.tasks],
  );
  const roomById = useMemo(() => new Map(floor.rooms.map((room) => [room.id, room])), [floor.rooms]);
  const occupants = useMemo(
    () => ops.agents.filter((agent) => roomById.has(agent.roomId)),
    [ops.agents, roomById],
  );

  return (
    <group>
      {occupants.map((agent) => {
        const room = roomById.get(agent.roomId);
        const workstation = room?.workstations.find((ws) => ws.id === agent.workstationId);
        if (!room || !workstation) return null;
        const appearance = appearanceFor(agent.id);
        const facing = workstation.rotationY + Math.PI;
        const task = agent.currentTaskId ? tasksById.get(agent.currentTaskId) ?? null : null;
        const behaviour = behaviourFor(agent, task);
        return (
          <group key={agent.id}>
            <OfficeChair
              appearance={appearance}
              x={workstation.seat.x}
              z={workstation.seat.z}
              rotationY={facing}
              detail={detail}
            />
            {behaviour.visible && (
              <AgentCharacter
                agent={agent}
                seat={workstation.seat}
                facing={facing}
                detail={detail}
                selected={agent.id === selectedAgentId}
                onSelect={onSelectAgent}
                behaviour={behaviour}
              />
            )}
            {agent.id === selectedAgentId && (
              <LabelSprite
                text={agent.name}
                sub={`${agent.role} · ${agent.status.toLowerCase()}`}
                position={[workstation.seat.x, 2.05, workstation.seat.z]}
                accent="#54d6e6"
                scale={0.85}
              />
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
