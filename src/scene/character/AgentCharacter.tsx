'use client';

/**
 * A miniature human colleague.
 *
 * The mesh is a joint hierarchy of shared primitives driven by the pure pose
 * engine. One rig handle is registered per character and updated by the single
 * loop in `CharacterAnimator`; React never re-renders during animation.
 *
 * Movement and posture come from the activity system, not from this component:
 * the rig walks to whatever destination the agent's activity machine asked for
 * (a desk, another desk, a meeting chair), reports arrival truthfully, and
 * blends every pose change so joints never snap.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Agent, Building, Vec2 } from '@/domain/types';
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
  behaviourFor,
  phaseOffsetFor,
  restMotion,
  stepMotion,
  workActivity,
  type AgentBehaviour,
  type CharacterMotion,
} from './behaviour';
import {
  clearCharacterPosition,
  otherCharacterPositions,
  registerRig,
  reportCharacterPosition,
} from './characterSystem';
import {
  WALK_SPEED,
  advanceWalker,
  avoidanceFor,
  createWalker,
  planJourney,
  withLateralOffset,
  type Journey,
  type Walker,
} from './journey';
import { agentActivity, destinationKey, reportArrival } from './activitySystem';
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

/** Exponential approach, frame-rate independent. */
function approach(current: number, target: number, dt: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

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
  readonly building: Building;
  /** Room the agent is currently assigned to. */
  readonly roomId: string;
  readonly floorId: string;
  readonly seat: Vec2;
  readonly facing: number;
  readonly detail: DetailLevel;
  readonly selected: boolean;
  readonly onSelect: (agentId: string) => void;
  /** Optional task context so ERROR/WAITING states can explain themselves. */
  readonly behaviour?: AgentBehaviour;
}

/**
 * One colleague. Position is driven by the journey walker when the agent has
 * been relocated (walking through doors and corridors, riding the lift between
 * floors) and by the short seat/away motion otherwise.
 */
export function AgentCharacter({
  agent,
  building,
  roomId,
  floorId,
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
  const elevation = useMemo(
    () => building.floors.find((floor) => floor.id === floorId)?.elevation ?? 0,
    [building, floorId],
  );

  const rootRef = useRef<THREE.Group | null>(null);
  const jointRefs = useRef<Partial<Record<JointName, THREE.Object3D>>>({});
  const fingerRefs = useRef<Record<string, THREE.Object3D | null>>({});
  const motionRef = useRef<CharacterMotion>(restMotion);
  const facingRef = useRef(facing);
  const journeyRef = useRef<Journey | null>(null);
  const walkerRef = useRef<Walker | null>(null);
  const locationRef = useRef<{ floorId: string; point: Vec2 }>({ floorId, point: seat });
  const planRef = useRef<{ key: string; journey: Journey | null; walker: Walker | null }>({
    key: '',
    journey: null,
    walker: null,
  });
  const seatedRef = useRef(1);
  const walkRef = useRef(0);
  const warnedRef = useRef('');

  const latest = useRef({
    behaviour,
    seat,
    facing,
    floorId,
    roomId,
    detail,
    elevation,
    agentId: agent.id,
  });
  latest.current = { behaviour, seat, facing, floorId, roomId, detail, elevation, agentId: agent.id };

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

  const elevationByFloor = useMemo(() => {
    const map = new Map<string, number>();
    for (const floor of building.floors) map.set(floor.id, floor.elevation);
    return map;
  }, [building]);

  useEffect(() => {
    const handle = {
      id: `character:${agent.id}`,
      apply(time: number, dt: number) {
        const root = rootRef.current;
        if (!root) return;
        const current = latest.current;
        const activity = agentActivity(current.agentId);
        const behaviour = current.behaviour;
        const animation = activity?.animation ?? {
          seated: behaviour.seated,
          standing: behaviour.standing,
          posture: behaviour.away ? ('STANDING' as const) : ('SEATED' as const),
        };
        const visible = activity ? activity.visible : behaviour.visible;
        const destination = activity?.destination ?? {
          kind: 'workstation' as const,
          floorId: current.floorId,
          roomId: current.roomId,
          point: current.seat,
          facing: current.facing,
          chairId: null,
        };
        const localTime = time + timeOffset;
        const seated =
          animation.seated === 'TYPING'
            ? workActivity(current.agentId, localTime)
            : animation.seated;

        // --- destination: replan a walk whenever the activity sends the
        // colleague somewhere new (another desk, a meeting chair, a floor).
        const key = destinationKey(destination);
        const plan = planRef.current;
        if (key !== plan.key) {
          plan.key = key;
          plan.journey = null;
          plan.walker = null;
          const from = locationRef.current;
          const sameFloor = from.floorId === destination.floorId;
          const gap = Math.hypot(
            from.point.x - destination.point.x,
            from.point.z - destination.point.z,
          );
          if (!sameFloor || gap > 0.2) {
            const planned = planJourney(building, from, {
              floorId: destination.floorId,
              point: destination.point,
            });
            if (planned.ok && planned.length > 0.22) {
              plan.journey = planned;
              plan.walker = createWalker(planned, facingRef.current);
              if (planned.adjusted && warnedRef.current !== key) {
                warnedRef.current = key;
                console.info(`[nexora] ${agent.id}: ${planned.note ?? 'destination adjusted'}`);
              }
            } else if (!planned.ok) {
              // No route at all: stay where the body is and say why. Never
              // teleport to a destination the agent cannot walk to.
              if (warnedRef.current !== key) {
                warnedRef.current = key;
                console.warn(
                  `[nexora] No walkable route for ${agent.id}: ${planned.reason} — ${planned.message}`,
                );
              }
            } else {
              locationRef.current = { floorId: destination.floorId, point: destination.point };
              reportArrival(current.agentId);
            }
          } else {
            locationRef.current = { floorId: destination.floorId, point: destination.point };
            reportArrival(current.agentId);
          }
          motionRef.current = restMotion;
        }

        const journey = plan.journey;
        const walker = plan.walker;
        let x = locationRef.current.point.x;
        let z = locationRef.current.point.z;
        let elevation = elevationByFloor.get(locationRef.current.floorId) ?? 0;
        let walkPhase = motionRef.current.phase;
        let walkAmount = 0;
        let travelling = false;

        if (journey && walker && !walker.done) {
          travelling = true;
          const avoid = avoidanceFor(
            current.agentId,
            walker.position,
            walker.facing,
            otherCharacterPositions(current.agentId),
          );
          const next = advanceWalker(walker, journey, dt, WALK_SPEED * avoid.speed);
          plan.walker = next;
          const placed = withLateralOffset(next.position, next.facing, avoid.lateral);
          x = placed.x;
          z = placed.z;
          elevation = next.elevation;
          walkPhase = next.walkPhase;
          walkAmount = next.phase === 'WALKING' ? 1 : 0;
          root.visible = next.visible && visible;
          facingRef.current = dampAngle(facingRef.current, next.facing, dt, 6);
          locationRef.current = { floorId: next.floorId, point: next.position };
          if (next.done) {
            plan.journey = null;
            plan.walker = null;
            locationRef.current = { floorId: destination.floorId, point: destination.point };
            reportArrival(current.agentId);
          }
        } else {
          // Standing beside the desk needs a short side-step, not a route.
          const standing = animation.posture === 'STANDING';
          const side = behaviour.side;
          const away = awayPoint(destination.point, destination.facing, side);
          const pathLength = Math.hypot(
            away.x - destination.point.x,
            away.z - destination.point.z,
          );
          const motion = stepMotion(motionRef.current, standing ? pathLength : 0, dt);
          motionRef.current = motion;
          const progress = pathLength > 1e-4 ? clamp01(motion.progress / pathLength) : 0;
          x = destination.point.x + (away.x - destination.point.x) * progress;
          z = destination.point.z + (away.z - destination.point.z) * progress;
          elevation = elevationByFloor.get(destination.floorId) ?? 0;
          walkPhase = motion.phase;
          walkAmount = motion.moving ? motion.walking : 0;
          const desiredFacing =
            standing && progress > 0.02
              ? awayFacing(destination.facing, side)
              : destination.facing;
          facingRef.current = dampAngle(facingRef.current, desiredFacing, dt, 6);
          root.visible = visible;
          locationRef.current = { floorId: destination.floorId, point: destination.point };
        }

        root.position.set(x, elevation, z);
        root.rotation.y = facingRef.current;
        reportCharacterPosition(current.agentId, { x, z });

        // Blended posture: sitting down and standing up take ~0.5 s, walking
        // fades the seated pose out, so no transition ever snaps.
        const seatedTarget =
          !travelling && animation.posture === 'SEATED' ? 1 : 0;
        seatedRef.current = approach(seatedRef.current, seatedTarget, dt, 5);
        walkRef.current = approach(walkRef.current, walkAmount, dt, 7);

        applyPose(
          buildPose({
            seated,
            standing: animation.standing,
            seatedMix: seatedRef.current,
            walkPhase,
            walking: walkRef.current,
            time: localTime,
            seed,
            proportions: appearance.proportions,
          }),
          dt,
        );
      },
    };

    function applyPose(pose: CharacterPose, dt: number): void {
      // Joint-level damping: pose changes from the activity machine cross-fade
      // instead of jumping between keyframe families.
      const blend = 1 - Math.exp(-14 * dt);
      for (const name of Array.from(JOINT_NAMES)) {
        const object = jointRefs.current[name];
        if (!object) continue;
        const target = pose.joints[name];
        object.rotation.set(
          object.rotation.x + (target.x - object.rotation.x) * blend,
          object.rotation.y + (target.y - object.rotation.y) * blend,
          object.rotation.z + (target.z - object.rotation.z) * blend,
        );
      }
      const hips = jointRefs.current.hips;
      if (hips) hips.position.y += (pose.hipHeight - hips.position.y) * blend;
      const fingersL = fingerRefs.current['fingers-L'];
      if (fingersL) {
        const target = -pose.fingersL * 1.15;
        fingersL.rotation.x += (target - fingersL.rotation.x) * blend;
      }
      const fingersR = fingerRefs.current['fingers-R'];
      if (fingersR) {
        const target = -pose.fingersR * 1.15;
        fingersR.rotation.x += (target - fingersR.rotation.x) * blend;
      }
    }

    const release = registerRig(handle);
    return () => {
      release();
      clearCharacterPosition(agent.id);
    };
  }, [agent.id, appearance.proportions, seed, timeOffset, building, elevationByFloor]);

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
      position={[seat.x, elevation, seat.z]}
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
  /** Floor elevation; the chair is positioned per floor. */
  readonly elevation?: number;
}

/** Task chair, sized to the occupant's lower leg so the seat is ergonomic. */
export function OfficeChair({
  appearance,
  x,
  z,
  rotationY,
  detail,
  elevation = 0,
}: OfficeChairProps) {
  const parts = useMemo(
    () => visibleParts(chairParts(appearance.proportions.seatedHipHeight), detail),
    [appearance, detail],
  );
  return (
    <group position={[x, elevation, z]} rotation-y={rotationY}>
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
