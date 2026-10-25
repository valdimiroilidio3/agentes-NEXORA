'use client';

/**
 * A miniature human colleague.
 *
 * The mesh is a joint hierarchy of shared primitives driven by the pure pose
 * engine. One rig handle is registered per character and updated by the single
 * loop in `CharacterAnimator`; React never re-renders during animation.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Agent, Vec2 } from '@/domain/types';
import { appearanceFor, seedFor } from './appearance';
import {
  bodyParts,
  chairParts,
  visibleParts,
  type BodyPart,
  type ChairPart,
  type DetailLevel,
  type PrimitiveKind,
} from './parts';
import { buildPose, JOINT_NAMES, layoutFor, type CharacterPose, type JointName } from './pose';
import {
  awayFacing,
  awayPoint,
  walkFacing,
  behaviourFor,
  phaseOffsetFor,
  restMotion,
  stepMotion,
  workActivity,
  type AgentBehaviour,
  type CharacterMotion,
} from './behaviour';
import { registerRig } from './characterSystem';
import { characterMaterial } from './characterMaterials';
import { materials, unitBox, unitCylinder, unitSphere, unitTorus } from '../materials';
import type { CharacterAppearance } from './appearance';

function geometryFor(kind: PrimitiveKind): THREE.BufferGeometry {
  if (kind === 'sphere') return unitSphere;
  if (kind === 'cylinder') return unitCylinder;
  return unitBox;
}

const boxy = (
  value: readonly [number, number, number] | { readonly x: number; readonly y: number; readonly z: number },
): [number, number, number] => {
  if (Array.isArray(value)) return [value[0], value[1], value[2]];
  const vec = value as { readonly x: number; readonly y: number; readonly z: number };
  return [vec.x, vec.y, vec.z];
};

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

function dampAngle(current: number, target: number, dt: number, lambda: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function useParts(appearance: CharacterAppearance, detail: DetailLevel) {
  return useMemo(() => {
    const parts = visibleParts(bodyParts(appearance), detail);
    const byJoint = new Map<JointName, BodyPart[]>();
    for (const part of parts) {
      const list = byJoint.get(part.joint) ?? [];
      list.push(part);
      byJoint.set(part.joint, list);
    }
    return { parts, byJoint };
  }, [appearance, detail]);
}

export interface AgentCharacterProps {
  readonly agent: Agent;
  readonly seat: Vec2;
  readonly facing: number;
  readonly detail: DetailLevel;
  readonly selected: boolean;
  readonly onSelect: (agentId: string) => void;
  /** Optional task context so ERROR/WAITING states can explain themselves. */
  readonly behaviour?: AgentBehaviour;
}

export function AgentCharacter({
  agent,
  seat,
  facing,
  detail,
  selected,
  onSelect,
  behaviour: behaviourProp,
}: AgentCharacterProps) {
  const appearance = useMemo(() => appearanceFor(agent.id), [agent.id]);
  const seed = useMemo(() => seedFor(agent.id), [agent.id]);
  const timeOffset = useMemo(() => phaseOffsetFor(agent.id), [agent.id]);
  const { byJoint } = useParts(appearance, detail);
  const layout = useMemo(() => layoutFor(appearance.proportions), [appearance]);
  const behaviour = useMemo(
    () => behaviourProp ?? behaviourFor(agent, null),
    [behaviourProp, agent],
  );

  const rootRef = useRef<THREE.Group | null>(null);
  const jointRefs = useRef<Partial<Record<JointName, THREE.Object3D>>>({});
  const fingerRefs = useRef<Record<string, THREE.Object3D | null>>({});
  const motionRef = useRef<CharacterMotion>(restMotion);
  const facingRef = useRef(facing);

  const latest = useRef({ behaviour, seat, facing, detail, agentId: agent.id });
  latest.current = { behaviour, seat, facing, detail, agentId: agent.id };

  const binders = useMemo(() => {
    const map = {} as Record<JointName, (object: THREE.Object3D | null) => void>;
    for (const name of JOINT_NAMES) {
      map[name] = (object) => {
        if (object) jointRefs.current[name] = object;
        else delete jointRefs.current[name];
      };
    }
    return map;
  }, []);

  useEffect(() => {
    const handle = {
      id: `character:${agent.id}`,
      apply(time: number, dt: number) {
        const root = rootRef.current;
        if (!root) return;
        const current = latest.current;
        const away = awayPoint(current.seat, current.facing, current.behaviour.side);
        const pathLength = Math.hypot(away.x - current.seat.x, away.z - current.seat.z);
        const target = current.behaviour.away ? pathLength : 0;
        const motion = stepMotion(motionRef.current, target, dt);
        motionRef.current = motion;

        const progress = pathLength > 1e-4 ? clamp01(motion.progress / pathLength) : 0;
        root.position.set(
          current.seat.x + (away.x - current.seat.x) * progress,
          0,
          current.seat.z + (away.z - current.seat.z) * progress,
        );
        // Follow the direction of travel while stepping out, then settle
        // facing the desk once the character stops.
        const desiredFacing = motion.moving
          ? walkFacing(current.facing, current.behaviour.side)
          : progress > 0.02
            ? awayFacing(current.facing, current.behaviour.side)
            : current.facing;
        facingRef.current = dampAngle(facingRef.current, desiredFacing, dt, 7);
        root.rotation.y = facingRef.current;

        const localTime = time + timeOffset;
        const seated =
          current.behaviour.seated === 'TYPING'
            ? workActivity(current.agentId, localTime)
            : current.behaviour.seated;
        const pose = buildPose({
          seated,
          standing: current.behaviour.standing,
          seatedMix: motion.seatedMix,
          walkPhase: motion.phase,
          walking: motion.walking,
          time: localTime,
          seed,
          proportions: appearance.proportions,
        });
        applyPose(pose);
      },
    };

    function applyPose(pose: CharacterPose): void {
      for (const name of JOINT_NAMES) {
        const object = jointRefs.current[name];
        if (!object) continue;
        const rotation = pose.joints[name];
        object.rotation.set(rotation.x, rotation.y, rotation.z);
      }
      const hips = jointRefs.current.hips;
      if (hips) hips.position.y = pose.hipHeight;
      const fingersL = fingerRefs.current['fingers-L'];
      if (fingersL) fingersL.rotation.x = -pose.fingersL * 1.15;
      const fingersR = fingerRefs.current['fingers-R'];
      if (fingersR) fingersR.rotation.x = -pose.fingersR * 1.15;
    }

    return registerRig(handle);
  }, [agent.id, appearance.proportions, seed, timeOffset]);

  const renderParts = (joint: JointName) =>
    (byJoint.get(joint) ?? []).map((part) => {
      const fingers = part.animated === 'fingers';
      return (
        <mesh
          key={part.id}
          geometry={geometryFor(part.geometry)}
          material={characterMaterial(part.material, appearance)}
          position={boxy(part.position)}
          scale={boxy(part.scale)}
          rotation={part.rotation ? boxy(part.rotation) : undefined}
          castShadow={part.tier === 'compact'}
          receiveShadow={part.tier === 'compact'}
          ref={
            fingers
              ? (object) => {
                  fingerRefs.current[part.id] = object;
                }
              : undefined
          }
        />
      );
    });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 5) return;
    event.stopPropagation();
    onSelect(agent.id);
  };

  return (
    <group
      ref={rootRef}
      name={`character-${agent.id}`}
      position={[seat.x, 0, seat.z]}
      rotation-y={facing}
    >
      <group ref={binders.hips}>
        {renderParts('hips')}
        <group ref={binders.spine} position={boxy(layout.spine)}>
          {renderParts('spine')}
          <group ref={binders.chest} position={boxy(layout.chest)}>
            {renderParts('chest')}
            <group ref={binders.neck} position={boxy(layout.neck)}>
              {renderParts('neck')}
              <group ref={binders.head} position={boxy(layout.head)}>
                {renderParts('head')}
              </group>
            </group>
            {(['L', 'R'] as const).map((side) => {
              const sign = side === 'L' ? 1 : -1;
              return (
                <group
                  key={side}
                  ref={binders[`shoulder${side}` as JointName]}
                  position={[sign * layout.shoulderX, layout.shoulderY, 0]}
                >
                  {renderParts(`shoulder${side}` as JointName)}
                  <group ref={binders[`elbow${side}` as JointName]} position={boxy(layout.elbow)}>
                    {renderParts(`elbow${side}` as JointName)}
                    <group ref={binders[`wrist${side}` as JointName]} position={boxy(layout.wrist)}>
                      {renderParts(`wrist${side}` as JointName)}
                    </group>
                  </group>
                </group>
              );
            })}
          </group>
        </group>
        {(['L', 'R'] as const).map((side) => {
          const sign = side === 'L' ? 1 : -1;
          return (
            <group
              key={side}
              ref={binders[`hip${side}` as JointName]}
              position={[sign * layout.hipJointX, layout.hipJointY, 0]}
            >
              {renderParts(`hip${side}` as JointName)}
              <group ref={binders[`knee${side}` as JointName]} position={boxy(layout.knee)}>
                {renderParts(`knee${side}` as JointName)}
                <group ref={binders[`ankle${side}` as JointName]} position={boxy(layout.ankle)}>
                  {renderParts(`ankle${side}` as JointName)}
                </group>
              </group>
            </group>
          );
        })}
      </group>

      {selected && (
        <mesh
          geometry={unitTorus}
          material={materials.selection}
          position={[0, 0.02, 0]}
          rotation-x={-Math.PI / 2}
          scale={[0.66, 0.66, 0.66]}
        />
      )}

      {/* Generous invisible hit target for pointer interaction. */}
      <mesh position={[0, 0.85, 0]} onClick={handleClick} onPointerOver={pointerOver} onPointerOut={pointerOut}>
        <boxGeometry args={[0.75, 1.7, 0.75]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

function pointerOver(event: ThreeEvent<PointerEvent>) {
  event.stopPropagation();
  document.body.style.cursor = 'pointer';
}

function pointerOut() {
  document.body.style.cursor = 'auto';
}

export interface OfficeChairProps {
  readonly appearance: CharacterAppearance;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly detail: DetailLevel;
}

/** Task chair, sized to the occupant's lower leg so the seat is ergonomic. */
export function OfficeChair({ appearance, x, z, rotationY, detail }: OfficeChairProps) {
  const parts = useMemo(
    () => visibleParts(chairParts(appearance.proportions.seatedHipHeight), detail),
    [appearance, detail],
  );
  return (
    <group position={[x, 0, z]} rotation-y={rotationY}>
      {parts.map((part: ChairPart) => (
        <mesh
          key={part.id}
          geometry={geometryFor(part.geometry)}
          material={materials[part.material]}
          position={boxy(part.position)}
          scale={boxy(part.scale)}
          rotation={part.rotation ? boxy(part.rotation) : undefined}
          castShadow={part.tier === 'compact'}
          receiveShadow
        />
      ))}
    </group>
  );
}

export { geometryFor };
