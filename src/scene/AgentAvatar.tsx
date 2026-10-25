'use client';

import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Agent } from '@/domain/types';
import { AGENT_ACCENTS } from '@/domain/agents';
import { materials, unitBox, unitCylinder, unitSphere, unitTorus } from './materials';

const bodyMaterials = new Map<string, THREE.MeshStandardMaterial>();

function bodyMaterial(accent: Agent['accent']): THREE.Material {
  const cached = bodyMaterials.get(accent);
  if (cached) return cached;
  const material = new THREE.MeshStandardMaterial({
    color: AGENT_ACCENTS[accent],
    roughness: 0.55,
    metalness: 0.15,
    emissive: new THREE.Color(AGENT_ACCENTS[accent]),
    emissiveIntensity: 0.12,
  });
  bodyMaterials.set(accent, material);
  return material;
}

const statusMaterial = {
  WORKING: materials.statusActive,
  WAITING: materials.statusWaiting,
  ERROR: materials.statusError,
  IDLE: materials.statusIdle,
  OFFLINE: materials.statusOffline,
} as const;

export interface AgentAvatarProps {
  readonly agent: Agent;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly selected: boolean;
  readonly onSelect: (agentId: string) => void;
}

export function AgentAvatar({ agent, x, z, rotationY, selected, onSelect }: AgentAvatarProps) {
  const ring = useRef<THREE.Mesh>(null);
  const body = agent.status === 'OFFLINE' ? materials.statusOffline : bodyMaterial(agent.accent);
  const ringMaterial = statusMaterial[agent.status];
  const working = agent.status === 'WORKING';

  useFrame(({ clock }) => {
    if (!ring.current) return;
    if (working) {
      const pulse = 1 + Math.sin(clock.elapsedTime * 2.6) * 0.14;
      ring.current.scale.set(pulse, pulse, pulse);
    } else if (ring.current.scale.x !== 1) {
      ring.current.scale.set(1, 1, 1);
    }
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 5) return;
    event.stopPropagation();
    onSelect(agent.id);
  };

  return (
    <group position={[x, 0, z]} rotation-y={rotationY}>
      {/* Chair */}
      <mesh geometry={unitBox} material={materials.fabric} position={[0, 0.45, 0]} scale={[0.5, 0.08, 0.5]} castShadow />
      <mesh
        geometry={unitBox}
        material={materials.fabric}
        position={[0, 0.74, -0.22]}
        scale={[0.5, 0.5, 0.06]}
        castShadow
      />
      {/* Body */}
      <mesh geometry={unitCylinder} material={body} position={[0, 0.78, 0.04]} scale={[0.34, 0.46, 0.3]} castShadow />
      <mesh geometry={unitSphere} material={body} position={[0, 1.16, 0.04]} scale={[0.26, 0.26, 0.26]} castShadow />
      {/* Status ring on the floor */}
      {agent.status !== 'OFFLINE' && (
        <mesh
          ref={ring}
          geometry={unitTorus}
          material={ringMaterial}
          position={[0, 0.03, 0.1]}
          rotation-x={-Math.PI / 2}
          scale={[0.75, 0.75, 0.75]}
        />
      )}
      {selected && (
        <mesh
          geometry={unitTorus}
          material={materials.selection}
          position={[0, 0.05, 0.1]}
          rotation-x={-Math.PI / 2}
          scale={[1.1, 1.1, 1.1]}
        />
      )}
      {/* Invisible, generous hit target for pointer interaction */}
      <mesh
        position={[0, 0.8, 0]}
        onClick={handleClick}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto';
        }}
      >
        <boxGeometry args={[0.9, 1.6, 0.9]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
