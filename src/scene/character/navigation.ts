/**
 * Floor navigation.
 *
 * A walkability grid is carved from the compiled building (room interiors +
 * corridor + door throats) and then furniture footprints are subtracted. Routes
 * are A* paths over that grid, smoothed by line-of-sight so agents walk in
 * straight lines across open floor instead of stair-stepping along cells.
 *
 * Pure and deterministic: no React, no Three.js, no timers. The same module is
 * used by the renderer, by the tests and by `npm run stats`.
 */
import type { Building, Floor, FurnitureKind, Room, Vec2 } from '@/domain/types';

/** Shoulder width of the widest colleague, with a little margin. */
export const AGENT_RADIUS = 0.26;
const WALL_CLEARANCE = 0.05;
export const CELL = 0.2;

/** Axis-aligned footprint of a furniture kind, in metres. */
const FOOTPRINTS: Partial<Record<FurnitureKind, readonly [number, number]>> = {
  desk: [1.6, 0.8],
  chair: [0.55, 0.55],
  monitor: [0.5, 0.22],
  shelf: [1.2, 0.45],
  sofa: [2.1, 0.9],
  'coffee-table': [1.1, 0.6],
  'meeting-table': [3.2, 1.4],
  plant: [0.62, 0.62],
  counter: [2.6, 0.8],
  credenza: [1.8, 0.5],
  'server-rack': [0.8, 1.1],
  bench: [2.0, 0.5],
  stool: [0.45, 0.45],
  stair: [1.8, 3.2],
};

/** Kinds that sit against a wall or underfoot and never block a walkway. */
const TRANSPARENT: ReadonlySet<FurnitureKind> = new Set<FurnitureKind>([
  'whiteboard',
  'elevator-door',
  'video-wall',
  'rug',
  'turnstile',
]);

export interface Footprint {
  readonly x: number;
  readonly z: number;
  readonly halfW: number;
  readonly halfD: number;
}

function footprintOf(room: Room): Footprint[] {
  const out: Footprint[] = [];
  for (const item of room.furniture) {
    if (TRANSPARENT.has(item.kind)) continue;
    const size = FOOTPRINTS[item.kind];
    if (!size) continue;
    const quarterTurn = Math.abs(Math.sin(item.rotationY)) > 0.7;
    const scale = item.scale ?? 1;
    const width = (quarterTurn ? size[1] : size[0]) * scale;
    const depth = (quarterTurn ? size[0] : size[1]) * scale;
    out.push({
      x: item.position.x,
      z: item.position.z,
      halfW: width / 2 + AGENT_RADIUS,
      halfD: depth / 2 + AGENT_RADIUS,
    });
  }
  return out;
}

export interface FloorNav {
  readonly floorId: string;
  readonly cell: number;
  readonly minX: number;
  readonly minZ: number;
  readonly cols: number;
  readonly rows: number;
  /** 1 = walkable. */
  readonly walkable: Uint8Array;
}

const navCache = new Map<string, FloorNav>();

function doorThroat(room: Room, building: Building): Footprint {
  const outward = room.door.edge === 'north' || room.door.edge === 'south' ? 0.6 : 0.6;
  const halfSpan = Math.max(0.15, room.door.width / 2 - AGENT_RADIUS);
  const atEdge =
    room.door.edge === 'north'
      ? room.rect.z - room.rect.depth / 2
      : room.door.edge === 'south'
        ? room.rect.z + room.rect.depth / 2
        : room.door.edge === 'west'
          ? room.rect.x - room.rect.width / 2
          : room.rect.x + room.rect.width / 2;
  void building;
  if (room.door.edge === 'north' || room.door.edge === 'south') {
    return {
      x: room.rect.x + room.door.offset,
      z: atEdge,
      halfW: halfSpan,
      halfD: outward,
    };
  }
  return {
    x: atEdge,
    z: room.rect.z + room.door.offset,
    halfW: outward,
    halfD: halfSpan,
  };
}

export function buildFloorNav(building: Building, floor: Floor): FloorNav {
  const cached = navCache.get(floor.id);
  if (cached && cached.cols > 0) return cached;

  const halfW = building.footprint.width / 2;
  const halfD = building.footprint.depth / 2;
  const minX = -halfW;
  const minZ = -halfD;
  const cols = Math.ceil((halfW * 2) / CELL);
  const rows = Math.ceil((halfD * 2) / CELL);
  const walkable = new Uint8Array(cols * rows);

  const insetRoom = building.interiorWallThickness / 2 + WALL_CLEARANCE + AGENT_RADIUS;
  const corridors = {
    minZ: -building.corridorDepth / 2 + WALL_CLEARANCE + AGENT_RADIUS,
    maxZ: building.corridorDepth / 2 - WALL_CLEARANCE - AGENT_RADIUS,
    minX: -halfW + building.exteriorWallThickness + AGENT_RADIUS,
    maxX: halfW - building.exteriorWallThickness - AGENT_RADIUS,
  };

  const rooms = floor.rooms.map((room) => ({
    room,
    minX: room.rect.x - room.rect.width / 2 + insetRoom,
    maxX: room.rect.x + room.rect.width / 2 - insetRoom,
    minZ: room.rect.z - room.rect.depth / 2 + insetRoom,
    maxZ: room.rect.z + room.rect.depth / 2 - insetRoom,
    throat: doorThroat(room, building),
    obstacles: footprintOf(room),
  }));

  for (let row = 0; row < rows; row += 1) {
    const z = minZ + (row + 0.5) * CELL;
    for (let col = 0; col < cols; col += 1) {
      const x = minX + (col + 0.5) * CELL;
      let open =
        (z >= corridors.minZ && z <= corridors.maxZ && x >= corridors.minX && x <= corridors.maxX) ||
        false;
      if (!open) {
        for (const entry of rooms) {
          const inRoom = x > entry.minX && x < entry.maxX && z > entry.minZ && z < entry.maxZ;
          const inThroat =
            Math.abs(x - entry.throat.x) < entry.throat.halfW &&
            Math.abs(z - entry.throat.z) < entry.throat.halfD;
          if (!inRoom && !inThroat) continue;
          open = true;
          for (const obstacle of entry.obstacles) {
            if (
              Math.abs(x - obstacle.x) < obstacle.halfW &&
              Math.abs(z - obstacle.z) < obstacle.halfD
            ) {
              open = false;
              break;
            }
          }
          if (open) break;
        }
      }
      walkable[row * cols + col] = open ? 1 : 0;
    }
  }

  const nav: FloorNav = { floorId: floor.id, cell: CELL, minX, minZ, cols, rows, walkable };
  navCache.set(floor.id, nav);
  return nav;
}

export function clearNavCache(): void {
  navCache.clear();
}

function index(nav: FloorNav, x: number, z: number): { col: number; row: number } | null {
  const col = Math.floor((x - nav.minX) / nav.cell);
  const row = Math.floor((z - nav.minZ) / nav.cell);
  if (col < 0 || row < 0 || col >= nav.cols || row >= nav.rows) return null;
  return { col, row };
}

export function isWalkable(nav: FloorNav, point: Vec2): boolean {
  const cell = index(nav, point.x, point.z);
  if (!cell) return false;
  return nav.walkable[cell.row * nav.cols + cell.col] === 1;
}

export function nearestWalkable(nav: FloorNav, point: Vec2, radius = 8): { col: number; row: number } | null {
  const cell = index(nav, point.x, point.z);
  if (!cell) return null;
  if (nav.walkable[cell.row * nav.cols + cell.col] === 1) return cell;
  for (let ring = 1; ring <= radius; ring += 1) {
    for (let dz = -ring; dz <= ring; dz += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const col = cell.col + dx;
        const row = cell.row + dz;
        if (col < 0 || row < 0 || col >= nav.cols || row >= nav.rows) continue;
        if (nav.walkable[row * nav.cols + col] === 1) return { col, row };
      }
    }
  }
  return null;
}

/**
 * Closest walkable cell to `goal` that can actually be reached from `start`.
 * Used when the exact destination is walled off: the agent walks as close as
 * physically possible rather than standing still or clipping through walls.
 */
function nearestReachable(
  nav: FloorNav,
  start: { col: number; row: number },
  goal: { col: number; row: number },
): { col: number; row: number } | null {
  const seen = new Uint8Array(nav.cols * nav.rows);
  const goalPoint = centreOf(nav, goal.col, goal.row);
  const queue: number[] = [start.row * nav.cols + start.col];
  seen[queue[0]!] = 1;
  let best: { col: number; row: number } | null = null;
  let bestDistance = Infinity;
  let head = 0;
  while (head < queue.length) {
    const index = queue[head]!;
    head += 1;
    const col = index % nav.cols;
    const row = (index - col) / nav.cols;
    const point = centreOf(nav, col, row);
    const distance = Math.hypot(point.x - goalPoint.x, point.z - goalPoint.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { col, row };
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nextCol = col + dx;
      const nextRow = row + dz;
      if (nextCol < 0 || nextRow < 0 || nextCol >= nav.cols || nextRow >= nav.rows) continue;
      const nextIndex = nextRow * nav.cols + nextCol;
      if (seen[nextIndex] === 1) continue;
      if (nav.walkable[nextIndex] !== 1) continue;
      seen[nextIndex] = 1;
      queue.push(nextIndex);
    }
  }
  return best;
}

/**
 * Mask of every cell reachable on foot from `point`. Used by the validation
 * script and the tests to prove no walkable pocket is cut off from the lift.
 */
export function reachableFrom(nav: FloorNav, point: Vec2): Uint8Array {
  const seen = new Uint8Array(nav.cols * nav.rows);
  const start = nearestWalkable(nav, point);
  if (!start) return seen;
  const queue: number[] = [start.row * nav.cols + start.col];
  seen[queue[0]!] = 1;
  let head = 0;
  while (head < queue.length) {
    const index = queue[head]!;
    head += 1;
    const col = index % nav.cols;
    const row = (index - col) / nav.cols;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nextCol = col + dx;
      const nextRow = row + dz;
      if (nextCol < 0 || nextRow < 0 || nextCol >= nav.cols || nextRow >= nav.rows) continue;
      const nextIndex = nextRow * nav.cols + nextCol;
      if (seen[nextIndex] === 1 || nav.walkable[nextIndex] !== 1) continue;
      seen[nextIndex] = 1;
      queue.push(nextIndex);
    }
  }
  return seen;
}

const centreOf = (nav: FloorNav, col: number, row: number): Vec2 => ({
  x: nav.minX + (col + 0.5) * nav.cell,
  z: nav.minZ + (row + 0.5) * nav.cell,
});

/** Binary min-heap keyed on f-score. */
class Heap {
  private readonly items: Array<{ key: number; value: number }> = [];

  push(key: number, value: number): void {
    this.items.push({ key, value });
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.items[parent]!.key <= this.items[child]!.key) break;
      [this.items[parent], this.items[child]] = [this.items[child]!, this.items[parent]!];
      child = parent;
    }
  }

  pop(): number | null {
    if (this.items.length === 0) return null;
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.items.length && this.items[left]!.key < this.items[smallest]!.key) smallest = left;
        if (right < this.items.length && this.items[right]!.key < this.items[smallest]!.key) smallest = right;
        if (smallest === parent) break;
        [this.items[parent], this.items[smallest]] = [this.items[smallest]!, this.items[parent]!];
        parent = smallest;
      }
    }
    return top.value;
  }

  get size(): number {
    return this.items.length;
  }
}

const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

function astar(nav: FloorNav, start: { col: number; row: number }, goal: { col: number; row: number }): Vec2[] | null {
  const total = nav.cols * nav.rows;
  const gScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const startIndex = start.row * nav.cols + start.col;
  const goalIndex = goal.row * nav.cols + goal.col;
  const heuristic = (col: number, row: number) => Math.hypot(col - goal.col, row - goal.row);
  const open = new Heap();
  gScore[startIndex] = 0;
  open.push(heuristic(start.col, start.row), startIndex);

  while (open.size > 0) {
    const current = open.pop()!;
    if (current === goalIndex) break;
    if (closed[current] === 1) continue;
    closed[current] = 1;
    const col = current % nav.cols;
    const row = Math.floor(current / nav.cols);
    for (const [dx, dy, cost] of NEIGHBOURS) {
      const nc = col + dx;
      const nr = row + dy;
      if (nc < 0 || nr < 0 || nc >= nav.cols || nr >= nav.rows) continue;
      const nextIndex = nr * nav.cols + nc;
      if (closed[nextIndex] === 1) continue;
      if (nav.walkable[nextIndex] !== 1) continue;
      // No corner cutting through two blocked diagonals.
      if (dx !== 0 && dy !== 0) {
        if (nav.walkable[row * nav.cols + nc] !== 1) continue;
        if (nav.walkable[nr * nav.cols + col] !== 1) continue;
      }
      const tentative = gScore[current]! + cost;
      if (tentative >= gScore[nextIndex]!) continue;
      gScore[nextIndex] = tentative;
      cameFrom[nextIndex] = current;
      open.push(tentative + heuristic(nc, nr), nextIndex);
    }
  }

  if (cameFrom[goalIndex] === -1 && startIndex !== goalIndex) return null;
  const path: Vec2[] = [];
  let cursor = goalIndex;
  let guard = 0;
  while (cursor !== -1 && guard < total) {
    path.push(centreOf(nav, cursor % nav.cols, Math.floor(cursor / nav.cols)));
    if (cursor === startIndex) break;
    cursor = cameFrom[cursor]!;
    guard += 1;
  }
  return path.reverse();
}

/** True when a straight line between two points stays on walkable cells. */
export function lineOfSight(nav: FloorNav, a: Vec2, b: Vec2): boolean {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(2, Math.ceil(distance / (nav.cell * 0.5)));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (!isWalkable(nav, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
  }
  return true;
}

/** String-pulling: drop waypoints the agent can see past. */
function smooth(nav: FloorNav, points: readonly Vec2[]): Vec2[] {
  if (points.length <= 2) return [...points];
  const out: Vec2[] = [points[0]!];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = points.length - 1;
    while (next > anchor + 1 && !lineOfSight(nav, points[anchor]!, points[next]!)) next -= 1;
    out.push(points[next]!);
    anchor = next;
  }
  return out;
}

export interface Route {
  readonly ok: true;
  readonly floorId: string;
  readonly points: readonly Vec2[];
  readonly length: number;
  /**
   * True when the requested destination could not be reached and the route
   * ends at the closest reachable point instead. Callers surface this instead
   * of pretending the agent arrived where it was asked to go.
   */
  readonly adjusted?: boolean;
  readonly note?: string;
}

export interface RouteFailure {
  readonly ok: false;
  readonly floorId: string;
  readonly reason: 'OUT_OF_BOUNDS' | 'UNREACHABLE';
  readonly message: string;
}

export type RouteResult = Route | RouteFailure;

export function routeLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  }
  return total;
}

/**
 * Right-hand traffic in the corridor: colleagues heading east walk on the
 * south lane, colleagues heading west walk on the north lane. This is planned
 * into the route, so opposing traffic is separated before anyone moves.
 */
export function corridorLane(direction: number): number {
  return direction >= 0 ? 0.55 : -0.55;
}

function roomAt(floor: Floor, point: Vec2): Room | null {
  for (const room of floor.rooms) {
    if (
      Math.abs(point.x - room.rect.x) <= room.rect.width / 2 &&
      Math.abs(point.z - room.rect.z) <= room.rect.depth / 2
    ) {
      return room;
    }
  }
  return null;
}

function doorOutside(room: Room, laneZ: number): Vec2 {
  const doorX =
    room.door.edge === 'north' || room.door.edge === 'south'
      ? room.rect.x + room.door.offset
      : room.rect.x;
  const doorZ =
    room.door.edge === 'north' || room.door.edge === 'south'
      ? room.rect.z
      : room.rect.z + room.door.offset;
  return room.door.edge === 'north' || room.door.edge === 'south'
    ? { x: doorX, z: laneZ }
    : { x: doorX, z: doorZ };
}

/**
 * Plans a walk across one floor. The start and end points are snapped to the
 * nearest walkable cell, so a seat tucked under a desk still produces a route.
 *
 * Room-to-room walks are stitched from three sub-routes — room → corridor lane,
 * corridor lane → corridor lane, corridor lane → room — so the finished path
 * leaves through a real door, walks in the correct lane and enters through a
 * real door. Walks inside one room are a single A* path.
 */
export function planRoute(
  building: Building,
  floor: Floor,
  from: Vec2,
  to: Vec2,
): RouteResult {
  const nav = buildFloorNav(building, floor);
  const start = nearestWalkable(nav, from);
  const goal = nearestWalkable(nav, to);
  if (!start) {
    return {
      ok: false,
      floorId: floor.id,
      reason: 'OUT_OF_BOUNDS',
      message: `Start point is outside the walkable area of ${floor.name}.`,
    };
  }
  if (!goal) {
    return {
      ok: false,
      floorId: floor.id,
      reason: 'UNREACHABLE',
      message: `Destination is not reachable inside ${floor.name}.`,
    };
  }

  const missing = (message: string): RouteFailure => ({
    ok: false,
    floorId: floor.id,
    reason: 'UNREACHABLE',
    message,
  });

  const routeBetween = (a: { col: number; row: number }, b: { col: number; row: number }) => {
    const path = astar(nav, a, b);
    return path ? smooth(nav, path) : null;
  };

  const fromRoom = roomAt(floor, from);
  const toRoom = roomAt(floor, to);

  // The exact destination may be walled off (a seat deep inside a closed
  // room, a point behind furniture). Walk to the closest reachable cell and
  // say so, instead of failing the whole journey or clipping through geometry.
  const nearest = routeBetween(start, goal) ? null : nearestReachable(nav, start, goal);
  const effectiveGoal = nearest ?? goal;
  const straight = routeBetween(start, effectiveGoal);
  if (!straight) return missing(`No walkable path inside ${floor.name}.`);
  const adjusted = nearest
    ? {
        adjusted: true,
        note: 'Destination is walled off; stopping at the closest reachable point.',
      }
    : {};

  // Same room, or either end already in the corridor: a direct path is enough.
  if (!fromRoom || !toRoom || fromRoom.id === toRoom.id || nearest) {
    const endpoint = nearest ? centreOf(nav, nearest.col, nearest.row) : to;
    const points = smooth(nav, [from, ...straight, endpoint]);
    return { ok: true, floorId: floor.id, points, length: routeLength(points), ...adjusted };
  }

  const direction = Math.sign(to.x - from.x) || 1;
  const laneZ = corridorLane(direction);
  const exitPoint = doorOutside(fromRoom, laneZ);
  const entryPoint = doorOutside(toRoom, laneZ);
  const exitCell = nearestWalkable(nav, exitPoint);
  const entryCell = nearestWalkable(nav, entryPoint);
  if (!exitCell || !entryCell) {
    return missing(`A door on the route is not connected to the corridor in ${floor.name}.`);
  }

  const legOut = routeBetween(start, exitCell);
  const legIn = routeBetween(entryCell, goal);
  if (!legOut || !legIn) {
    return missing(`No walkable path between the rooms of ${floor.name}.`);
  }

  let corridor: Vec2[] | null = lineOfSight(nav, exitPoint, entryPoint)
    ? [exitPoint, entryPoint]
    : null;
  if (!corridor) {
    const lane = routeBetween(exitCell, entryCell);
    corridor = lane ? [exitPoint, ...lane, entryPoint] : null;
  }
  if (!corridor) {
    return missing(`The corridor lane is blocked in ${floor.name}.`);
  }

  const points: Vec2[] = [from];
  for (const point of [...legOut, ...corridor, ...legIn, to]) {
    const last = points[points.length - 1]!;
    if (Math.hypot(point.x - last.x, point.z - last.z) < 0.02) continue;
    points.push(point);
  }
  return { ok: true, floorId: floor.id, points, length: routeLength(points) };
}

/** In front of the lift doors: where a journey between floors starts and ends. */
export function liftAnchor(floor: Floor): Vec2 | null {
  const core = floor.rooms.find((room) => room.template === 'core');
  if (!core) return null;
  const doors = core.furniture.filter((item) => item.kind === 'elevator-door');
  if (doors.length === 0) return null;
  const avg = doors.reduce(
    (acc, door) => ({
      x: acc.x + door.position.x / doors.length,
      z: acc.z + door.position.z / doors.length,
    }),
    { x: 0, z: 0 },
  );
  const toCentre = { x: core.rect.x - avg.x, z: core.rect.z - avg.z };
  const magnitude = Math.hypot(toCentre.x, toCentre.z) || 1;
  return { x: avg.x + (toCentre.x / magnitude) * 0.95, z: avg.z + (toCentre.z / magnitude) * 0.95 };
}
