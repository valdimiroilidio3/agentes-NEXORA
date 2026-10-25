'use client';

/**
 * All colleagues of the building in one layer.
 *
 * Characters are deliberately *not* nested inside floor groups: a relocation
 * between floors has to keep the same React component (and therefore the same
 * walker state) alive while the character rides the lift. Positions are
 * floor-local and the group height comes from the floor elevation.
 */
import { useEffect, useMemo } from 'react';
import type { Building, Floor, Room } from '@/domain/types';
import type { OperationsState } from '@/domain/operations';
import { AgentCharacter, OfficeChair } from './AgentCharacter';
import { appearanceFor } from './appearance';
import { behaviourFor } from './behaviour';
import { activityFor, setActivityBuilding, syncActivities } from './activitySystem';
import type { ActivityContext } from './activity';
import type { DetailLevel } from './parts';
import { LabelSprite } from '../Labels';

export interface AgentLayerProps {
  readonly building: Building;
  readonly ops: OperationsState;
  /** Floors currently drawn; agents on hidden floors are skipped. */
  readonly visibleFloorIds: ReadonlySet<string>;
  readonly detail: DetailLevel;
  readonly selectedAgentId: string | null;
  readonly onSelectAgent: (agentId: string) => void;
}

export function AgentLayer({
  building,
  ops,
  visibleFloorIds,
  detail,
  selectedAgentId,
  onSelectAgent,
}: AgentLayerProps) {
  const roomIndex = useMemo(() => {
    const map = new Map<string, { room: Room; floor: Floor }>();
    for (const floor of building.floors) {
      for (const room of floor.rooms) map.set(room.id, { room, floor });
    }
    return map;
  }, [building]);

  const tasksById = useMemo(
    () => new Map(ops.tasks.map((task) => [task.id, task])),
    [ops.tasks],
  );

  /**
   * Operational context for the activity machines. Rebuilt whenever an agent
   * joins, leaves, is relocated or a task changes hands — the machines then
   * pick the new facts up on their next step, without reloading the scene.
   */
  const contexts = useMemo<ActivityContext[]>(() => {
    const list: ActivityContext[] = [];
    for (const agent of ops.agents) {
      const entry = roomIndex.get(agent.roomId);
      if (!entry) continue;
      const workstation = entry.room.workstations.find(
        (station) => station.id === agent.workstationId,
      );
      if (!workstation) continue;
      list.push({
        agent,
        task: agent.currentTaskId ? (tasksById.get(agent.currentTaskId) ?? null) : null,
        homeFloorId: entry.floor.id,
        homeRoomId: entry.room.id,
        homeSeat: workstation.seat,
        homeFacing: workstation.rotationY + Math.PI,
        meeting: null,
        atDestination: true,
      });
    }
    return list;
  }, [ops.agents, roomIndex, tasksById]);

  useEffect(() => {
    setActivityBuilding(building);
    syncActivities(contexts);
  }, [building, contexts]);

  return (
    <group>
      {ops.agents.map((agent) => {
        const entry = roomIndex.get(agent.roomId);
        if (!entry) return null;
        const workstation = entry.room.workstations.find(
          (station) => station.id === agent.workstationId,
        );
        if (!workstation) return null;

        // A colleague walking to a meeting on a visible floor is still drawn,
        // even when their own workstation is on a hidden storey.
        const activity = activityFor(agent.id);
        const activeFloorId = activity?.destination.floorId ?? entry.floor.id;
        const homeVisible = visibleFloorIds.has(entry.floor.id);
        if (!homeVisible && !visibleFloorIds.has(activeFloorId)) return null;
        if (!homeVisible && !activity) return null;

        const appearance = appearanceFor(agent.id);
        const facing = workstation.rotationY + Math.PI;
        const task = agent.currentTaskId ? (tasksById.get(agent.currentTaskId) ?? null) : null;
        const behaviour = behaviourFor(agent, task);

        return (
          <group key={agent.id}>
            {homeVisible && (
              <OfficeChair
                appearance={appearance}
                x={workstation.seat.x}
                z={workstation.seat.z}
                rotationY={facing}
                detail={detail}
                elevation={entry.floor.elevation}
              />
            )}
            {behaviour.visible && (
              <AgentCharacter
                agent={agent}
                building={building}
                roomId={entry.room.id}
                floorId={entry.floor.id}
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
                position={[
                  workstation.seat.x,
                  entry.floor.elevation + 2.05,
                  workstation.seat.z,
                ]}
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
