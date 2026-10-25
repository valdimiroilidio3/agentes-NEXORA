'use client';

/**
 * Centralised skeletal update loop.
 *
 * There is exactly one `useFrame` subscription for the whole workforce, so 27
 * animated characters cost one React/R3F callback per frame instead of 27. A
 * character registers a handle on mount and applies its own joint rotations.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { Vec2 } from '@/domain/types';
import { resetActivities, stepActivities } from './activitySystem';

export interface RigHandle {
  readonly id: string;
  apply: (time: number, dt: number) => void;
}

const rigs = new Map<string, RigHandle>();

/**
 * Live world positions of every rendered character, used for local avoidance.
 * Positions are floor-local; floors share the same footprint, so two agents on
 * different floors are distinguished by the rig registry rather than here.
 */
const positions = new Map<string, Vec2>();

export function reportCharacterPosition(id: string, point: Vec2): void {
  const existing = positions.get(id);
  if (existing && existing.x === point.x && existing.z === point.z) return;
  positions.set(id, { x: point.x, z: point.z });
}

export function clearCharacterPosition(id: string): void {
  positions.delete(id);
}

export function otherCharacterPositions(
  id: string,
): Array<{ id: string; position: Vec2 }> {
  const out: Array<{ id: string; position: Vec2 }> = [];
  for (const [key, value] of positions) {
    if (key !== id) out.push({ id: key, position: value });
  }
  return out;
}

export function characterPositionCount(): number {
  return positions.size;
}

export function registerRig(handle: RigHandle): () => void {
  rigs.set(handle.id, handle);
  return () => {
    if (rigs.get(handle.id) === handle) rigs.delete(handle.id);
  };
}

export function rigCount(): number {
  return rigs.size;
}

export function resetRigs(): void {
  rigs.clear();
  positions.clear();
}

export function updateRigs(time: number, dt: number): void {
  for (const rig of rigs.values()) rig.apply(time, dt);
}

/** Mount once per scene; drives every registered character. */
export function CharacterAnimator() {
  const last = useRef(0);
  useFrame((state, delta) => {
    // Clamp the delta so a stalled tab cannot teleport characters.
    const dt = delta > 0.1 ? 0.1 : delta;
    last.current += dt;
    // One scheduler for the whole workforce: activities first, then the rigs
    // that read them, so every character sees a consistent frame.
    stepActivities(dt);
    updateRigs(state.clock.elapsedTime, dt);
  });
  useEffect(
    () => () => {
      resetRigs();
      resetActivities();
    },
    [],
  );
  return null;
}
