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

export interface RigHandle {
  readonly id: string;
  apply: (time: number, dt: number) => void;
}

const rigs = new Map<string, RigHandle>();

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
    updateRigs(state.clock.elapsedTime, dt);
  });
  useEffect(
    () => () => {
      resetRigs();
    },
    [],
  );
  return null;
}
