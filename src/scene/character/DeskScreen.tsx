'use client';

/**
 * The live monitor on a workstation.
 *
 * Renders a plane just in front of the monitor glass, textured with the
 * occupant's current activity (see `deskScreens.ts`). It sits inside the agent
 * layer so it is only drawn where the agent is drawn, and it is never part of
 * the instanced furniture batches: each screen needs its own texture.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Agent, Room, Task, Workstation } from '@/domain/types';
import { agentActivity } from './activitySystem';
import {
  registerDeskScreen,
  screenContentFor,
  unregisterDeskScreen,
  type DeskScreenHandle,
} from './deskScreens';

/** Plane shared by every monitor face. */
const screenGeometry = new THREE.PlaneGeometry(0.98, 0.5);

export interface DeskScreenProps {
  readonly agent: Agent;
  readonly room: Room;
  readonly workstation: Workstation;
  readonly task: Task | null;
}

export function DeskScreen({ agent, room, workstation, task }: DeskScreenProps) {
  const latest = useRef({ agent, room, task });
  latest.current = { agent, room, task };

  const handleRef = useRef<DeskScreenHandle | null>(null);
  const handle = useMemo(() => {
    const screen = registerDeskScreen(agent.id, () => {
      const current = latest.current;
      return screenContentFor({
        agent: current.agent,
        task: current.task,
        roomName: current.room.name,
        activity: agentActivity(current.agent.id),
        at: new Date(),
      });
    });
    handleRef.current = screen;
    return screen;
    // The registration is per agent; content updates flow through `latest`.
  }, [agent.id]);

  const material = useMemo(() => {
    if (!handle) return null;
    return new THREE.MeshBasicMaterial({
      map: handle.texture,
      toneMapped: false,
    });
  }, [handle]);

  useEffect(() => {
    return () => {
      if (handle?.id === agent.id) unregisterDeskScreen(agent.id);
    };
  }, [agent.id, handle]);

  useEffect(() => {
    return () => material?.dispose();
  }, [material]);

  // The monitor glass sits 0.3 m behind the desk centre and faces the occupant.
  const rotation = workstation.rotationY;
  const x = workstation.position.x - Math.sin(rotation) * 0.3 + Math.sin(rotation) * 0.024;
  const z = workstation.position.z - Math.cos(rotation) * 0.3 + Math.cos(rotation) * 0.024;

  if (!material) return null;

  return (
    <mesh
      name={`screen-${agent.id}`}
      geometry={screenGeometry}
      material={material}
      position={[x, 1.22, z]}
      rotation-y={rotation}
    />
  );
}
