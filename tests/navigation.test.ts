import { describe, expect, it } from 'vitest';
import buildingFixture from '@/data/building.json';
import { loadBuilding } from '@/domain/building';
import {
  AGENT_RADIUS,
  buildFloorNav,
  clearNavCache,
  isWalkable,
  nearestWalkable,
  reachableFrom,
  liftAnchor,
  planRoute,
  routeLength,
} from '@/scene/character/navigation';
import {
  LIFT_WAIT,
  WALK_SPEED,
  advanceWalker,
  avoidanceFor,
  createWalker,
  planJourney,
  simulateJourney,
  withLateralOffset,
} from '@/scene/character/journey';
import type { Building, Floor, Vec2 } from '@/domain/types';

const { building } = loadBuilding(buildingFixture);
const floor1 = building.floors[1]!;

function room(floor: Floor, id: string) {
  const found = floor.rooms.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing room ${id}`);
  return found;
}

const seatOf = (floor: Floor, roomId: string, index = 0): Vec2 =>
  room(floor, roomId).workstations[index]!.seat;

/** Samples a polyline so tests can assert what the agent would walk over. */
function sampleRoute(points: readonly Vec2[], step = 0.12): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let s = 0; s <= count; s += 1) {
      const t = s / count;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

describe('walkability grid', () => {
  it('is carved from rooms, corridor and door throats', () => {
    for (const floor of building.floors) {
      const nav = buildFloorNav(building, floor);
      const walkable = nav.walkable.reduce((sum, value) => sum + value, 0);
      // Rooms + corridor ≈ 55 % of the plate; furniture removes the rest.
      expect(walkable).toBeGreaterThan(6000);
      expect(walkable).toBeLessThan(nav.walkable.length);
      // The corridor centre line is always walkable.
      for (let x = -15; x <= 15; x += 1) {
        expect(isWalkable(nav, { x, z: 0 })).toBe(true);
      }
    }
  });

  it('keeps desks, stair and racks out of the walkable area', () => {
    const nav = buildFloorNav(building, floor1);
    for (const candidate of floor1.rooms) {
      for (const item of candidate.furniture) {
        if (!['desk', 'meeting-table', 'server-rack', 'stair', 'shelf'].includes(item.kind)) continue;
        expect(isWalkable(nav, item.position)).toBe(false);
      }
    }
  });

  it('connects every workstation to the corridor', () => {
    for (const floor of building.floors) {
      for (const candidate of floor.rooms) {
        for (const station of candidate.workstations) {
          // The seat itself sits in the chair pocket, so the planner is allowed
          // to snap it; what matters is that a walk to the corridor exists.
          const route = planRoute(building, floor, station.seat, { x: station.seat.x, z: 0 });
          expect(route.ok).toBe(true);
        }
      }
    }
  });
});

describe('route planning', () => {
  it('routes every workstation to its room door through open floor', () => {
    for (const floor of building.floors) {
      for (const candidate of floor.rooms) {
        const door =
          candidate.door.edge === 'north' || candidate.door.edge === 'south'
            ? { x: candidate.rect.x + candidate.door.offset, z: candidate.rect.z }
            : { x: candidate.rect.x, z: candidate.rect.z + candidate.door.offset };
        for (const station of candidate.workstations) {
          const route = planRoute(building, floor, station.seat, door);
          expect(route.ok).toBe(true);
          if (!route.ok) continue;
          const nav = buildFloorNav(building, floor);
          // Interior waypoints are walkable; the seat itself may sit in the
          // chair pocket and is snapped by the planner.
          for (const point of route.points.slice(1, -1)) {
            expect(isWalkable(nav, point)).toBe(true);
          }
        }
      }
    }
  });

  it('crosses the corridor when the destination is on the other side', () => {
    const from = seatOf(floor1, 'f1-editorial');
    const to = seatOf(floor1, 'f1-copy');
    const route = planRoute(building, floor1, from, to);
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    const half = building.corridorDepth / 2;
    expect(route.points.some((point) => Math.abs(point.z) < half - AGENT_RADIUS)).toBe(true);
    // It must leave the north room, cross, and enter the south room.
    expect(route.points.some((point) => point.z > half)).toBe(true);
    expect(route.points.some((point) => point.z < -half)).toBe(true);
    expect(route.length).toBeGreaterThan(20);
  });

  it('never walks through desks or walls', () => {
    const from = seatOf(floor1, 'f1-research', 0);
    const to = seatOf(floor1, 'f1-research', 3);
    const route = planRoute(building, floor1, from, to);
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    const nav = buildFloorNav(building, floor1);
    for (const point of sampleRoute(route.points)) {
      expect(isWalkable(nav, point)).toBe(true);
    }
    const desks = floor1.rooms.flatMap((candidate) =>
      candidate.furniture.filter((item) => item.kind === 'desk'),
    );
    for (const point of sampleRoute(route.points)) {
      for (const desk of desks) {
        const insideDesk =
          Math.abs(point.x - desk.position.x) < 0.78 && Math.abs(point.z - desk.position.z) < 0.38;
        expect(insideDesk).toBe(false);
      }
    }
  });

  it('reports an honest failure instead of inventing a route', () => {
    const outside = planRoute(building, floor1, seatOf(floor1, 'f1-editorial'), { x: 200, z: 200 });
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(['OUT_OF_BOUNDS', 'UNREACHABLE']).toContain(outside.reason);
  });

  it('exposes the lift anchor inside the core on every floor', () => {
    const anchors = building.floors.map((floor) => liftAnchor(floor));
    for (const [index, anchor] of anchors.entries()) {
      expect(anchor).not.toBeNull();
      const floor = building.floors[index]!;
      const core = floor.rooms.find((candidate) => candidate.template === 'core')!;
      expect(anchor!.x).toBeGreaterThan(core.rect.x - core.rect.width / 2);
      expect(anchor!.x).toBeLessThan(core.rect.x + core.rect.width / 2);
      expect(isWalkable(buildFloorNav(building, floor), anchor!)).toBe(true);
    }
  });
});

describe('multi-floor journeys', () => {
  it('plans one leg inside a floor and two legs between floors', () => {
    const sameFloor = planJourney(
      building,
      { floorId: floor1.id, point: seatOf(floor1, 'f1-editorial') },
      { floorId: floor1.id, point: seatOf(floor1, 'f1-copy') },
    );
    expect(sameFloor.ok).toBe(true);
    if (sameFloor.ok) {
      expect(sameFloor.legs).toHaveLength(1);
      expect(sameFloor.usesLift).toBe(false);
    }

    const crossFloor = planJourney(
      building,
      { floorId: 'floor-1', point: seatOf(floor1, 'f1-content') },
      { floorId: 'floor-3', point: seatOf(building.floors[3]!, 'f3-api') },
    );
    expect(crossFloor.ok).toBe(true);
    if (crossFloor.ok) {
      expect(crossFloor.legs).toHaveLength(2);
      expect(crossFloor.usesLift).toBe(true);
      expect(crossFloor.legs[0]!.floorId).toBe('floor-1');
      expect(crossFloor.legs[1]!.floorId).toBe('floor-3');
      expect(crossFloor.legs[1]!.elevation - crossFloor.legs[0]!.elevation).toBeCloseTo(8.4, 5);
    }
  });

  it('rejects an unknown floor', () => {
    const result = planJourney(
      building,
      { floorId: 'floor-0', point: { x: 0, z: 0 } },
      { floorId: 'floor-99', point: { x: 0, z: 0 } },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('UNKNOWN_FLOOR');
  });
});

describe('walking a journey', () => {
  it('walks a floor leg at walking speed and stops exactly at the desk', () => {
    const journey = planJourney(
      building,
      { floorId: floor1.id, point: seatOf(floor1, 'f1-editorial') },
      { floorId: floor1.id, point: seatOf(floor1, 'f1-copy') },
    );
    expect(journey.ok).toBe(true);
    if (!journey.ok) return;

    const walker = createWalker(journey, 0);
    let state = walker;
    let seconds = 0;
    let frames = 0;
    while (!state.done && frames < 3000) {
      state = advanceWalker(state, journey, 1 / 60);
      seconds += 1 / 60;
      frames += 1;
      expect(Number.isFinite(state.position.x)).toBe(true);
      expect(Number.isFinite(state.position.z)).toBe(true);
      expect(state.visible).toBe(true);
    }

    expect(state.done).toBe(true);
    expect(state.phase).toBe('ARRIVED');
    const destination = journey.legs[0]!.points.at(-1)!;
    expect(state.position.x).toBeCloseTo(destination.x, 6);
    expect(state.position.z).toBeCloseTo(destination.z, 6);
    // Distance / speed, with a little tolerance for the snapped seat.
    const expected = journey.length / WALK_SPEED;
    expect(seconds).toBeGreaterThan(expected * 0.9);
    expect(seconds).toBeLessThan(expected * 1.25);
    expect(state.walkPhase).toBeGreaterThan(10);
  });

  it('rides the lift between floors instead of teleporting', () => {
    const from = building.floors[1]!;
    const to = building.floors[3]!;
    const journey = planJourney(
      building,
      { floorId: from.id, point: seatOf(from, 'f1-content') },
      { floorId: to.id, point: seatOf(to, 'f3-api') },
    );
    expect(journey.ok).toBe(true);
    if (!journey.ok) return;

    let state = createWalker(journey, 0);
    let seconds = 0;
    let sawWaiting = false;
    let sawRiding = false;
    let lastFloor = state.floorId;
    let frames = 0;
    while (!state.done && frames < 6000) {
      state = advanceWalker(state, journey, 1 / 60);
      seconds += 1 / 60;
      frames += 1;
      if (state.phase === 'WAITING_LIFT') sawWaiting = true;
      if (state.phase === 'RIDING_LIFT') {
        sawRiding = true;
        expect(state.visible).toBe(false);
        expect(state.position.x).toBeCloseTo(liftAnchor(from)!.x, 6);
      }
      if (state.floorId !== lastFloor) lastFloor = state.floorId;
      // Elevation only changes inside the lift.
      if (state.phase === 'WALKING') {
        expect(state.elevation).toBeCloseTo(
          state.floorId === from.id ? from.elevation : to.elevation,
          6,
        );
      }
    }

    expect(sawWaiting).toBe(true);
    expect(sawRiding).toBe(true);
    expect(lastFloor).toBe(to.id);
    expect(state.elevation).toBeCloseTo(to.elevation, 6);
    expect(seconds).toBeGreaterThan(LIFT_WAIT);
    expect(state.visible).toBe(true);
  });

  it('simulates a whole cross-floor journey deterministically', () => {
    const groundSeat = building.floors[0]!.rooms.find(
      (candidate) => candidate.workstations.length > 0,
    )!.workstations[0]!.seat;
    const topFloor = building.floors[4]!;
    const topSeat = topFloor.rooms.find((candidate) => candidate.workstations.length > 0)!
      .workstations[0]!.seat;
    const journey = planJourney(
      building,
      { floorId: 'floor-0', point: groundSeat },
      { floorId: 'floor-4', point: topSeat },
    );
    expect(journey.ok).toBe(true);
    if (!journey.ok) return;
    const first = simulateJourney(journey, 1 / 30);
    const second = simulateJourney(journey, 1 / 30);
    expect(first.seconds).toBeCloseTo(second.seconds, 6);
    expect(first.walker.done).toBe(true);
    expect(first.seconds).toBeGreaterThan(20);
  });
});

describe('local avoidance', () => {
  it('slows down for somebody ahead and ignores people behind', () => {
    // 'b' has the higher id, so it yields to 'a'.
    const yielder = avoidanceFor('b', { x: 0, z: 0 }, 0, [{ id: 'a', position: { x: 0, z: 0.45 } }]);
    expect(yielder.speed).toBeLessThan(0.5);
    expect(Math.abs(yielder.lateral)).toBeGreaterThan(0.05);

    const priority = avoidanceFor('a', { x: 0, z: 0 }, 0, [{ id: 'b', position: { x: 0, z: 0.45 } }]);
    expect(priority.speed).toBe(1);
    expect(priority.lateral).toBe(0);

    const behind = avoidanceFor('b', { x: 0, z: 0 }, 0, [{ id: 'a', position: { x: 0, z: -0.5 } }]);
    expect(behind.speed).toBe(1);
    expect(behind.lateral).toBe(0);

    const far = avoidanceFor('b', { x: 0, z: 0 }, 0, [{ id: 'a', position: { x: 0, z: 4 } }]);
    expect(far.speed).toBe(1);
  });

  it('lets two colleagues pass each other in the corridor', () => {
    const a = planJourney(
      building,
      { floorId: floor1.id, point: seatOf(floor1, 'f1-editorial') },
      { floorId: floor1.id, point: seatOf(floor1, 'f1-copy') },
    );
    const b = planJourney(
      building,
      { floorId: floor1.id, point: seatOf(floor1, 'f1-copy') },
      { floorId: floor1.id, point: seatOf(floor1, 'f1-editorial') },
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    let walkerA = createWalker(a, 0);
    let walkerB = createWalker(b, Math.PI);
    let posA = walkerA.position;
    let posB = walkerB.position;
    let closest = Infinity;
    for (let frame = 0; frame < 4000 && !(walkerA.done && walkerB.done); frame += 1) {
      const avoidA = avoidanceFor('agent-a', posA, walkerA.facing, [
        { id: 'agent-b', position: posB },
      ]);
      const avoidB = avoidanceFor('agent-b', posB, walkerB.facing, [
        { id: 'agent-a', position: posA },
      ]);
      walkerA = advanceWalker(walkerA, a, 1 / 60, WALK_SPEED * avoidA.speed);
      walkerB = advanceWalker(walkerB, b, 1 / 60, WALK_SPEED * avoidB.speed);
      posA = withLateralOffset(walkerA.position, walkerA.facing, avoidA.lateral);
      posB = withLateralOffset(walkerB.position, walkerB.facing, avoidB.lateral);
      closest = Math.min(closest, Math.hypot(posA.x - posB.x, posA.z - posB.z));
    }
    expect(walkerA.done && walkerB.done).toBe(true);
    // Two people walking past each other keep a shoulder's width apart.
    expect(closest).toBeGreaterThan(0.55);
  });
});

describe('caching', () => {
  it('reuses the grid between calls and can be cleared', () => {
    const first = buildFloorNav(building, floor1);
    const second = buildFloorNav(building, floor1);
    expect(second).toBe(first);
    clearNavCache();
    const third = buildFloorNav(building, floor1);
    expect(third).not.toBe(first);
    expect(third.walkable.length).toBe(first.walkable.length);
  });

  it('computes a route length that matches its polyline', () => {
    const route = planRoute(
      building,
      floor1,
      seatOf(floor1, 'f1-editorial'),
      seatOf(floor1, 'f1-content'),
    );
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.length).toBeCloseTo(routeLength(route.points), 6);
  });
});

// Keep the type import used even if a future refactor drops a helper.
const _typecheck: Building | null = null;
void _typecheck;
describe('blocked destinations', () => {
  it('reports an impossible destination honestly instead of inventing a route', () => {
    const floor = building.floors[2]!;
    const room = floor.rooms.find((item) => item.workstations.length > 1)!;
    const from = room.workstations[0]!.seat;
    const to = room.workstations[1]!.seat;
    const journey = planJourney(
      building,
      { floorId: floor.id, point: from },
      { floorId: floor.id, point: { x: to.x, z: to.z + 40 } },
    );
    expect(journey.ok).toBe(false);
    if (!journey.ok) expect(journey.reason).toBe('UNREACHABLE');
  });

  it('routes a chair tucked under a desk to the closest walkable cell', () => {
    const floor = building.floors[1]!;
    const nav = buildFloorNav(building, floor);
    const room = floor.rooms.find((item) => item.workstations.length > 0)!;
    const station = room.workstations[0]!;
    const route = planRoute(building, floor, liftAnchor(floor)!, station.seat);
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.adjusted).toBeUndefined();
    // Every intermediate waypoint is walkable; the final point is the seat
    // itself, which sits under the desk by design.
    for (const point of route.points.slice(0, -1)) {
      expect(isWalkable(nav, point)).toBe(true);
    }
    const end = route.points[route.points.length - 1]!;
    expect(Math.hypot(end.x - station.seat.x, end.z - station.seat.z)).toBeLessThan(0.35);
  });

  it('leaves no walkable pocket disconnected from the lift on any floor', () => {
    for (const floor of building.floors) {
      const anchor = liftAnchor(floor);
      expect(anchor).not.toBeNull();
      const nav = buildFloorNav(building, floor);
      expect(nearestWalkable(nav, anchor!)).not.toBeNull();
      const reachable = reachableFrom(nav, anchor ?? { x: 0, z: 0 });
      let walkable = 0;
      let covered = 0;
      for (let row = 0; row < nav.rows; row += 1) {
        for (let col = 0; col < nav.cols; col += 1) {
          if (nav.walkable[row * nav.cols + col] !== 1) continue;
          walkable += 1;
          if (reachable[row * nav.cols + col] === 1) covered += 1;
        }
      }
      // Every walkable cell on every floor is reachable, so a colleague never
      // gets stranded — and the "closest reachable point" fallback only has to
      // cover genuinely off-grid requests.
      expect(covered, `${floor.id}: ${covered}/${walkable}`).toBe(walkable);
    }
  });
});
