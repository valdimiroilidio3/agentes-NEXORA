/**
 * Multi-floor journeys.
 *
 * A journey is one or two walking legs joined by a lift ride. Planning is pure
 * (it delegates to `navigation.ts`); `advanceWalker` integrates a journey over
 * real frame deltas, including the wait for the lift and the ride itself, so a
 * colleague never teleports between floors.
 */
import type { Building, Floor, Vec2 } from '@/domain/types';
import { liftAnchor, planRoute } from './navigation';

export const WALK_SPEED = 1.05;
export const LIFT_WAIT = 1.1;
export const LIFT_RIDE_BASE = 0.8;
export const LIFT_RIDE_PER_METRE = 0.09;

export interface JourneyLeg {
  readonly floorId: string;
  readonly elevation: number;
  readonly points: readonly Vec2[];
  readonly length: number;
}

export interface Journey {
  readonly ok: true;
  readonly legs: readonly JourneyLeg[];
  readonly usesLift: boolean;
  readonly length: number;
  /** True when a leg had to stop short of the exact destination. */
  readonly adjusted?: boolean;
  readonly note?: string;
}

export interface JourneyFailure {
  readonly ok: false;
  readonly reason: 'UNKNOWN_FLOOR' | 'NO_LIFT' | 'UNREACHABLE';
  readonly message: string;
}

export type JourneyResult = Journey | JourneyFailure;

const floorById = (building: Building, floorId: string): Floor | undefined =>
  building.floors.find((floor) => floor.id === floorId);

export function planJourney(
  building: Building,
  from: { readonly floorId: string; readonly point: Vec2 },
  to: { readonly floorId: string; readonly point: Vec2 },
): JourneyResult {
  const fromFloor = floorById(building, from.floorId);
  const toFloor = floorById(building, to.floorId);
  if (!fromFloor || !toFloor) {
    return {
      ok: false,
      reason: 'UNKNOWN_FLOOR',
      message: `Unknown floor: ${!fromFloor ? from.floorId : to.floorId}.`,
    };
  }

  if (fromFloor.id === toFloor.id) {
    const route = planRoute(building, fromFloor, from.point, to.point);
    if (!route.ok) return { ok: false, reason: 'UNREACHABLE', message: route.message };
    return {
      ok: true,
      usesLift: false,
      length: route.length,
      ...(route.adjusted ? { adjusted: true, note: route.note } : {}),
      legs: [
        {
          floorId: fromFloor.id,
          elevation: fromFloor.elevation,
          points: route.points,
          length: route.length,
        },
      ],
    };
  }

  const fromLift = liftAnchor(fromFloor);
  const toLift = liftAnchor(toFloor);
  if (!fromLift || !toLift) {
    return {
      ok: false,
      reason: 'NO_LIFT',
      message: 'This building has no lift core, so floors cannot be connected.',
    };
  }

  const first = planRoute(building, fromFloor, from.point, fromLift);
  if (!first.ok) return { ok: false, reason: 'UNREACHABLE', message: first.message };
  const second = planRoute(building, toFloor, toLift, to.point);
  if (!second.ok) return { ok: false, reason: 'UNREACHABLE', message: second.message };

  return {
    ok: true,
    usesLift: true,
    length: first.length + second.length,
    ...(first.adjusted || second.adjusted
      ? { adjusted: true, note: 'Part of the journey ends at the closest reachable point.' }
      : {}),
    legs: [
      {
        floorId: fromFloor.id,
        elevation: fromFloor.elevation,
        points: first.points,
        length: first.length,
      },
      {
        floorId: toFloor.id,
        elevation: toFloor.elevation,
        points: second.points,
        length: second.length,
      },
    ],
  };
}

export type WalkPhase = 'WALKING' | 'WAITING_LIFT' | 'RIDING_LIFT' | 'ARRIVED';

export interface Walker {
  readonly legIndex: number;
  readonly pointIndex: number;
  readonly position: Vec2;
  readonly floorId: string;
  /** Interpolated while riding the lift. */
  readonly elevation: number;
  readonly facing: number;
  readonly phase: WalkPhase;
  readonly phaseTime: number;
  readonly rideDuration: number;
  readonly travelled: number;
  readonly walkPhase: number;
  readonly done: boolean;
  readonly visible: boolean;
}

const headingOf = (from: Vec2, to: Vec2): number => Math.atan2(to.x - from.x, to.z - from.z);

export function createWalker(journey: Journey, facing: number): Walker {
  const leg = journey.legs[0]!;
  const start = leg.points[0] ?? { x: 0, z: 0 };
  return {
    legIndex: 0,
    pointIndex: leg.points.length > 1 ? 1 : 0,
    position: start,
    floorId: leg.floorId,
    elevation: leg.elevation,
    facing,
    phase: leg.points.length > 1 ? 'WALKING' : journey.legs.length > 1 ? 'WAITING_LIFT' : 'ARRIVED',
    phaseTime: 0,
    rideDuration: 0,
    travelled: 0,
    walkPhase: 0,
    done: journey.legs.length === 1 && leg.points.length <= 1,
    visible: true,
  };
}

function rideDurationFor(fromElevation: number, toElevation: number): number {
  return LIFT_RIDE_BASE + Math.abs(toElevation - fromElevation) * LIFT_RIDE_PER_METRE;
}

/**
 * Advances one frame. `dt` is clamped by the caller; the walker never skips a
 * waypoint or overshoots the destination.
 */
export function advanceWalker(
  walker: Walker,
  journey: Journey,
  dt: number,
  speed = WALK_SPEED,
): Walker {
  if (walker.done) return walker;
  const step = Math.max(0, Math.min(0.1, dt)) * speed;

  switch (walker.phase) {
    case 'WALKING': {
      const leg = journey.legs[walker.legIndex]!;
      let position = walker.position;
      let pointIndex = walker.pointIndex;
      let remaining = step;
      let travelled = walker.travelled;
      let walkPhase = walker.walkPhase;
      let facing = walker.facing;

      while (remaining > 1e-6 && pointIndex < leg.points.length) {
        const target = leg.points[pointIndex]!;
        const dx = target.x - position.x;
        const dz = target.z - position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 1e-6) {
          pointIndex += 1;
          continue;
        }
        facing = headingOf(position, target);
        if (remaining >= distance) {
          position = target;
          remaining -= distance;
          travelled += distance;
          walkPhase += (distance / 1.36) * Math.PI * 2;
          pointIndex += 1;
        } else {
          const t = remaining / distance;
          position = { x: position.x + dx * t, z: position.z + dz * t };
          travelled += remaining;
          walkPhase += (remaining / 1.36) * Math.PI * 2;
          remaining = 0;
        }
      }

      if (pointIndex >= leg.points.length) {
        const lastLeg = walker.legIndex >= journey.legs.length - 1;
        if (lastLeg) {
          return {
            ...walker,
            position,
            pointIndex,
            facing,
            travelled,
            walkPhase,
            phase: 'ARRIVED',
            done: true,
          };
        }
        return {
          ...walker,
          position,
          pointIndex,
          facing,
          travelled,
          walkPhase,
          phase: 'WAITING_LIFT',
          phaseTime: 0,
        };
      }

      return { ...walker, position, pointIndex, facing, travelled, walkPhase };
    }
    case 'WAITING_LIFT': {
      const phaseTime = walker.phaseTime + dt;
      if (phaseTime < LIFT_WAIT) return { ...walker, phaseTime };
      const next = journey.legs[walker.legIndex + 1]!;
      return {
        ...walker,
        phase: 'RIDING_LIFT',
        phaseTime: 0,
        rideDuration: rideDurationFor(walker.elevation, next.elevation),
        visible: false,
      };
    }
    case 'RIDING_LIFT': {
      const phaseTime = walker.phaseTime + dt;
      const target = journey.legs[walker.legIndex + 1]!;
      if (phaseTime < walker.rideDuration) {
        const t = phaseTime / walker.rideDuration;
        return {
          ...walker,
          phaseTime,
          elevation: walker.elevation + (target.elevation - walker.elevation) * t,
        };
      }
      const start = target.points[0] ?? walker.position;
      return {
        ...walker,
        legIndex: walker.legIndex + 1,
        pointIndex: target.points.length > 1 ? 1 : 0,
        position: start,
        floorId: target.floorId,
        elevation: target.elevation,
        phase: target.points.length > 1 ? 'WALKING' : 'ARRIVED',
        phaseTime: 0,
        visible: true,
        done: target.points.length <= 1,
        facing: target.points.length > 1 ? headingOf(start, target.points[1]!) : walker.facing,
      };
    }
    default:
      return walker;
  }
}

export interface NearbyAgent {
  readonly id: string;
  readonly position: Vec2;
}

export interface Avoidance {
  /** Multiplier for the walking speed, 0 … 1. */
  readonly speed: number;
  /** Lateral step away from the blocker, in metres (0 … 0.4). */
  readonly lateral: number;
}

/**
 * Local avoidance for corridor traffic.
 *
 * Priority is decided by agent id: the colleague with the higher id yields.
 * The yielding agent slows down and steps to its own right, so two agents
 * meeting head-on in a corridor pass each other instead of walking through
 * each other, and the outcome is deterministic (no random jitter).
 */
export function avoidanceFor(
  id: string,
  position: Vec2,
  heading: number,
  others: readonly NearbyAgent[],
  radius = 0.62,
): Avoidance {
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  let speed = 1;
  let lateral = 0;
  for (const other of others) {
    if (other.position.x === position.x && other.position.z === position.z) continue;
    const dx = other.position.x - position.x;
    const dz = other.position.z - position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > radius * 1.9) continue;
    const ahead = (dx * forwardX + dz * forwardZ) / distance;
    if (ahead < -0.35) continue;
    // Corridor lanes already keep opposing traffic apart: only react when the
    // other agent is actually in (or brushing) our line of travel.
    const gap = Math.abs(forwardX * dz - forwardZ * dx);
    if (gap > 0.55) continue;
    // The higher id yields to the lower one, deterministically.
    if (other.id > id) continue;

    const clearance = Math.max(0, (distance - radius * 0.9) / (radius * 1.1));
    speed = Math.min(speed, Math.max(0.05, clearance));
    // Step away from the other agent; head-on encounters default to the right.
    const side = gap < 0.12 ? 1 : forwardX * dz - forwardZ * dx > 0 ? -1 : 1;
    const push = Math.min(0.85, Math.max(0, radius * 2.4 - distance));
    if (push > lateral) lateral = side * push;
  }
  return { speed, lateral };
}

export function avoidanceFactor(
  id: string,
  position: Vec2,
  heading: number,
  others: readonly NearbyAgent[],
  radius = 0.62,
): number {
  return avoidanceFor(id, position, heading, others, radius).speed;
}

/** Point `lateral` metres to the right of `position` for a given heading. */
export function withLateralOffset(position: Vec2, heading: number, lateral: number): Vec2 {
  if (lateral === 0) return position;
  return {
    x: position.x + Math.cos(heading) * lateral,
    z: position.z - Math.sin(heading) * lateral,
  };
}

/** Runs a whole journey at a fixed timestep; used by tests and the stats script. */
export function simulateJourney(journey: Journey, dt = 1 / 30, facing = 0): {
  readonly seconds: number;
  readonly frames: number;
  readonly walker: Walker;
} {
  let walker = createWalker(journey, facing);
  let frames = 0;
  let seconds = 0;
  while (!walker.done && frames < 60 * 60) {
    walker = advanceWalker(walker, journey, dt);
    frames += 1;
    seconds += dt;
  }
  return { seconds, frames, walker };
}
