/**
 * Spatial mathematics + building validation.
 *
 * Pure functions only: no React, no Three.js. Every function that builds
 * geometry also states which coordinate space it works in.
 */
import type {
  Building,
  DoorSpec,
  Floor,
  Rect,
  Room,
  Vec2,
  WallEdge,
} from './types';

/* ------------------------------------------------------------------ */
/* Rectangle helpers (floor plane)                                     */
/* ------------------------------------------------------------------ */

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export const EPSILON = 1e-6;

export function rectBounds(rect: Rect): Bounds {
  return {
    minX: rect.x - rect.width / 2,
    maxX: rect.x + rect.width / 2,
    minZ: rect.z - rect.depth / 2,
    maxZ: rect.z + rect.depth / 2,
  };
}

export function rectArea(rect: Rect): number {
  return rect.width * rect.depth;
}

export function rectsOverlap(a: Rect, b: Rect, tolerance = 0.001): boolean {
  const ba = rectBounds(a);
  const bb = rectBounds(b);
  const overlapX = Math.min(ba.maxX, bb.maxX) - Math.max(ba.minX, bb.minX);
  const overlapZ = Math.min(ba.maxZ, bb.maxZ) - Math.max(ba.minZ, bb.minZ);
  return overlapX > tolerance && overlapZ > tolerance;
}

export function rectContainsRect(outer: Rect, inner: Rect, tolerance = 0.002): boolean {
  const o = rectBounds(outer);
  const i = rectBounds(inner);
  return (
    i.minX >= o.minX - tolerance &&
    i.maxX <= o.maxX + tolerance &&
    i.minZ >= o.minZ - tolerance &&
    i.maxZ <= o.maxZ + tolerance
  );
}

export function pointInRect(point: Vec2, rect: Rect, inset = 0): boolean {
  const b = rectBounds(rect);
  return (
    point.x >= b.minX + inset - EPSILON &&
    point.x <= b.maxX - inset + EPSILON &&
    point.z >= b.minZ + inset - EPSILON &&
    point.z <= b.maxZ - inset + EPSILON
  );
}

export function rectIntersectsRect(a: Rect, b: Rect, tolerance = 0.001): boolean {
  return rectsOverlap(a, b, tolerance);
}

/** Distance between two rectangles (0 when they touch or overlap). */
export function rectDistance(a: Rect, b: Rect): number {
  const ba = rectBounds(a);
  const bb = rectBounds(b);
  const dx = Math.max(0, Math.max(ba.minX - bb.maxX, bb.minX - ba.maxX));
  const dz = Math.max(0, Math.max(ba.minZ - bb.maxZ, bb.minZ - ba.maxZ));
  return Math.hypot(dx, dz);
}

export function insetRect(rect: Rect, inset: number): Rect {
  return {
    x: rect.x,
    z: rect.z,
    width: Math.max(0, rect.width - inset * 2),
    depth: Math.max(0, rect.depth - inset * 2),
  };
}

export function distance2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ------------------------------------------------------------------ */
/* Building-level spaces                                               */
/* ------------------------------------------------------------------ */

/**
 * Interior extents of a floor footprint, i.e. the area available to rooms
 * after the exterior façade thickness is removed.
 */
export function interiorBounds(building: Building): Bounds {
  const halfW = building.footprint.width / 2 - building.exteriorWallThickness;
  const halfD = building.footprint.depth / 2 - building.exteriorWallThickness;
  return { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD };
}

export function interiorRect(building: Building): Rect {
  const b = interiorBounds(building);
  return {
    x: (b.minX + b.maxX) / 2,
    z: (b.minZ + b.maxZ) / 2,
    width: b.maxX - b.minX,
    depth: b.maxZ - b.minZ,
  };
}

/** The circulation band that runs east-west through every floor. */
export function corridorRect(building: Building): Rect {
  return {
    x: 0,
    z: 0,
    width: interiorRect(building).width,
    depth: building.corridorDepth,
  };
}

export function floorBounds(building: Building): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: -building.footprint.width / 2,
    maxX: building.footprint.width / 2,
    minZ: -building.footprint.depth / 2,
    maxZ: building.footprint.depth / 2,
  };
}

/* ------------------------------------------------------------------ */
/* Doors and walls                                                     */
/* ------------------------------------------------------------------ */

export function edgeAxis(edge: WallEdge): 'x' | 'z' {
  return edge === 'north' || edge === 'south' ? 'x' : 'z';
}

/** Length of the wall a door is cut into. */
export function edgeLength(room: Room, edge: WallEdge): number {
  return edgeAxis(edge) === 'x' ? room.rect.width : room.rect.depth;
}

/** Signed world coordinate of the wall plane for an edge. */
export function wallCoordinate(room: Room, edge: WallEdge): number {
  const b = rectBounds(room.rect);
  switch (edge) {
    case 'north':
      return b.minZ;
    case 'south':
      return b.maxZ;
    case 'west':
      return b.minX;
    case 'east':
      return b.maxX;
  }
}

/** Centre point of the door opening in floor-local coordinates. */
export function doorPoint(room: Room, door: DoorSpec = room.door): Vec2 {
  const b = rectBounds(room.rect);
  switch (door.edge) {
    case 'north':
      return { x: room.rect.x + door.offset, z: b.minZ };
    case 'south':
      return { x: room.rect.x + door.offset, z: b.maxZ };
    case 'west':
      return { x: b.minX, z: room.rect.z + door.offset };
    case 'east':
      return { x: b.maxX, z: room.rect.z + door.offset };
  }
}

/** Area that must stay clear of furniture so the door can be used. */
export function doorClearanceRect(room: Room, clearance = 1.25): Rect {
  const p = doorPoint(room);
  const w = room.door.width + 0.5;
  switch (room.door.edge) {
    case 'north':
      return { x: p.x, z: p.z + clearance / 2, width: w, depth: clearance };
    case 'south':
      return { x: p.x, z: p.z - clearance / 2, width: w, depth: clearance };
    case 'west':
      return { x: p.x + clearance / 2, z: p.z, width: clearance, depth: w };
    case 'east':
      return { x: p.x - clearance / 2, z: p.z, width: clearance, depth: w };
  }
}

/** Footprint of an agent's seat in floor-local coordinates. */
export function seatAnchor(position: Vec2, rotationY: number, offset = 0.9): Vec2 {
  return {
    x: position.x + Math.sin(rotationY) * offset,
    z: position.z + Math.cos(rotationY) * offset,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  readonly code: string;
  readonly severity: IssueSeverity;
  readonly message: string;
  readonly floorId?: string;
  readonly roomId?: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}

const MIN_ROOM_DIMENSION = 2.4;

/** Kinds designed to stand against a wall: checked by footprint, not centre. */
const WALL_MOUNTED = new Set([
  'whiteboard',
  'video-wall',
  'elevator-door',
  'shelf',
  'credenza',
  'turnstile',
]);

const TEMPLATE_MIN_AREA: Partial<Record<Room['template'], number>> = {
  'open-workspace': 30,
  'meeting-room': 14,
  'executive-office': 20,
  lab: 20,
  'operations-center': 40,
  reception: 30,
  core: 8,
};

export function validateBuilding(building: Building): ValidationResult {
  const issues: ValidationIssue[] = [];
  const seenRoomIds = new Set<string>();
  const seenFloorIds = new Set<string>();
  const interior = interiorRect(building);
  const interiorB = interiorBounds(building);
  const corridor = corridorRect(building);

  const error = (code: string, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ code, severity: 'error', message, ...extra });
  const warn = (code: string, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ code, severity: 'warning', message, ...extra });

  if (building.floors.length === 0) error('building.empty', 'Building has no floors.');

  const expectedFloorHeight = building.floorHeight;
  if (expectedFloorHeight < 2.8) {
    error('building.floorHeight', `Floor height ${expectedFloorHeight}m is too low for an office.`);
  }

  building.floors.forEach((floor, order) => {
    if (seenFloorIds.has(floor.id)) error('floor.duplicateId', `Duplicate floor id "${floor.id}".`);
    seenFloorIds.add(floor.id);

    if (floor.index !== order) {
      error(
        'floor.indexOrder',
        `Floor "${floor.id}" has index ${floor.index} but is at position ${order}.`,
        { floorId: floor.id },
      );
    }
    const expectedElevation = floor.index * building.floorHeight;
    if (Math.abs(floor.elevation - expectedElevation) > 1e-6) {
      error(
        'floor.elevation',
        `Floor "${floor.id}" elevation ${floor.elevation}m does not match index × floorHeight (${expectedElevation}m).`,
        { floorId: floor.id },
      );
    }
    if (Math.abs(floor.footprint.width - building.footprint.width) > 1e-6) {
      error('floor.footprint', `Floor "${floor.id}" width does not match the building.`, {
        floorId: floor.id,
      });
    }
    if (Math.abs(floor.footprint.depth - building.footprint.depth) > 1e-6) {
      error('floor.footprint', `Floor "${floor.id}" depth does not match the building.`, {
        floorId: floor.id,
      });
    }

    const maxCeiling = building.floorHeight - building.slabThickness;
    if (floor.ceilingHeight > maxCeiling + 1e-6) {
      error(
        'floor.ceilingHeight',
        `Floor "${floor.id}" ceiling height ${floor.ceilingHeight}m exceeds slab-to-slab clearance (${maxCeiling}m).`,
        { floorId: floor.id },
      );
    }

    const codes = new Set<string>();
    const rooms = floor.rooms;
    if (rooms.length === 0) error('floor.noRooms', `Floor "${floor.id}" has no rooms.`, { floorId: floor.id });

    for (const room of rooms) {
      if (seenRoomIds.has(room.id)) {
        error('room.duplicateId', `Duplicate room id "${room.id}".`, { roomId: room.id, floorId: floor.id });
      }
      seenRoomIds.add(room.id);

      if (codes.has(room.code)) {
        error('room.duplicateCode', `Duplicate room code "${room.code}" on ${floor.name}.`, {
          roomId: room.id,
          floorId: floor.id,
        });
      }
      codes.add(room.code);

      if (room.floorId !== floor.id) {
        error('room.floorMismatch', `Room "${room.id}" declares floor "${room.floorId}".`, {
          roomId: room.id,
          floorId: floor.id,
        });
      }

      if (room.rect.width < MIN_ROOM_DIMENSION || room.rect.depth < MIN_ROOM_DIMENSION) {
        error(
          'room.dimensions',
          `Room "${room.id}" is ${room.rect.width}×${room.rect.depth}m, below the ${MIN_ROOM_DIMENSION}m minimum.`,
          { roomId: room.id, floorId: floor.id },
        );
      }

      if (!rectContainsRect(interior, room.rect)) {
        error('room.outOfBounds', `Room "${room.id}" extends outside the floor interior.`, {
          roomId: room.id,
          floorId: floor.id,
        });
      }

      if (rectsOverlap(room.rect, corridor)) {
        error('room.corridorOverlap', `Room "${room.id}" intrudes into the circulation corridor.`, {
          roomId: room.id,
          floorId: floor.id,
        });
      }

      const minArea = TEMPLATE_MIN_AREA[room.template];
      if (minArea !== undefined && rectArea(room.rect) < minArea) {
        warn(
          'room.templateArea',
          `Room "${room.id}" (${room.template}) has ${rectArea(room.rect).toFixed(1)}m², below the suggested ${minArea}m².`,
          { roomId: room.id, floorId: floor.id },
        );
      }

      if (room.ceilingHeight < 2.4) {
        error('room.ceilingHeight', `Room "${room.id}" ceiling is below 2.4m.`, {
          roomId: room.id,
          floorId: floor.id,
        });
      }
      if (room.ceilingHeight > floor.ceilingHeight + 1e-6) {
        error(
          'room.ceilingHeight',
          `Room "${room.id}" ceiling ${room.ceilingHeight}m is taller than its floor (${floor.ceilingHeight}m).`,
          { roomId: room.id, floorId: floor.id },
        );
      }

      const halfEdge = edgeLength(room, room.door.edge) / 2;
      if (Math.abs(room.door.offset) + room.door.width / 2 > halfEdge + 1e-6) {
        error('room.doorOutsideWall', `Door of room "${room.id}" falls outside its wall.`, {
          roomId: room.id,
          floorId: floor.id,
        });
      }
      if (room.door.width < 0.8) {
        error('room.doorWidth', `Door of room "${room.id}" is narrower than 0.8m.`, {
          roomId: room.id,
          floorId: floor.id,
        });
      }

      // A door must reach circulation: it must face the corridor band.
      const door = doorPoint(room);
      const roomBounds = rectBounds(room.rect);
      const facesCorridor =
        (room.door.edge === 'south' && roomBounds.maxZ <= 0 + 1e-6) ||
        (room.door.edge === 'north' && roomBounds.minZ >= 0 - 1e-6);
      if (!facesCorridor) {
        warn(
          'room.doorCirculation',
          `Door of room "${room.id}" does not open onto the central corridor.`,
          { roomId: room.id, floorId: floor.id },
        );
      }
      if (door.x < interiorB.minX || door.x > interiorB.maxX) {
        error('room.doorPosition', `Door of room "${room.id}" is outside the floor plate.`, {
          roomId: room.id,
          floorId: floor.id,
        });
      }

      const clearance = doorClearanceRect(room);
      const envelope = insetRect(room.rect, 0.02);
      const freestanding = insetRect(room.rect, 0.2);

      for (const item of room.furniture) {
        const footprint = furnitureFootprint(item.position, item.kind, item.rotationY, item.scale);
        const inside = WALL_MOUNTED.has(item.kind)
          ? rectContainsRect(envelope, footprint, 0.04)
          : pointInRect(item.position, freestanding);
        if (!inside) {
          error(
            'furniture.outOfBounds',
            `Furniture "${item.id}" (${item.kind}) is outside room "${room.id}".`,
            { roomId: room.id, floorId: floor.id },
          );
        }
        if (rectIntersectsRect(clearance, footprint, 0.01)) {
          error(
            'furniture.blocksDoor',
            `Furniture "${item.id}" (${item.kind}) blocks the door of room "${room.id}".`,
            { roomId: room.id, floorId: floor.id },
          );
        }
      }

      const wsIds = new Set<string>();
      const positions: Vec2[] = [];
      for (const ws of room.workstations) {
        if (wsIds.has(ws.id)) {
          error('workstation.duplicateId', `Duplicate workstation id "${ws.id}".`, { roomId: room.id });
        }
        wsIds.add(ws.id);
        if (ws.roomId !== room.id) {
          error('workstation.roomMismatch', `Workstation "${ws.id}" declares room "${ws.roomId}".`, {
            roomId: room.id,
          });
        }
        if (!pointInRect(ws.position, freestanding)) {
          error('workstation.outOfBounds', `Workstation "${ws.id}" is outside room "${room.id}".`, {
            roomId: room.id,
            floorId: floor.id,
          });
        }
        if (!pointInRect(ws.seat, freestanding)) {
          error('workstation.seatOutOfBounds', `Seat of "${ws.id}" is outside room "${room.id}".`, {
            roomId: room.id,
          });
        }
        if (rectIntersectsRect(clearance, { x: ws.position.x, z: ws.position.z, width: 1.6, depth: 0.8 }, 0.01)) {
          error('workstation.blocksDoor', `Workstation "${ws.id}" blocks the door of room "${room.id}".`, {
            roomId: room.id,
          });
        }
        for (const other of positions) {
          if (distance2(ws.position, other) < 1.2) {
            warn('workstation.crowded', `Workstations in "${room.id}" are placed closer than 1.2m.`, {
              roomId: room.id,
            });
            break;
          }
        }
        positions.push(ws.position);
      }
    }

    // Pairwise room overlap (same floor).
    for (let i = 0; i < rooms.length; i += 1) {
      for (let j = i + 1; j < rooms.length; j += 1) {
        const a = rooms[i];
        const b = rooms[j];
        if (a && b && rectsOverlap(a.rect, b.rect)) {
          error('room.overlap', `Rooms "${a.id}" and "${b.id}" overlap.`, {
            roomId: a.id,
            floorId: floor.id,
          });
        }
      }
    }

    // Bands should be fully occupied, otherwise the floor plate has dead holes.
    const bands = [
      { minZ: interiorB.minZ, maxZ: -corridor.depth / 2, label: 'north' },
      { minZ: corridor.depth / 2, maxZ: interiorB.maxZ, label: 'south' },
    ];
    for (const band of bands) {
      const inBand = rooms.filter((room) => {
        const b = rectBounds(room.rect);
        return b.minZ >= band.minZ - 0.01 && b.maxZ <= band.maxZ + 0.01;
      });
      const covered = inBand.reduce((sum, room) => sum + room.rect.width, 0);
      const bandWidth = interiorB.maxX - interiorB.minX;
      if (Math.abs(covered - bandWidth) > 0.05) {
        warn(
          'floor.bandCoverage',
          `Floor "${floor.id}" ${band.label} band covers ${covered.toFixed(1)}m of ${bandWidth.toFixed(1)}m.`,
          { floorId: floor.id },
        );
      }
    }
  });

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return { ok: errors.length === 0, issues, errors, warnings };
}

/**
 * Conservative furniture footprint used by the door-clearance check.
 * Dimensions mirror the renderer's furniture catalogue.
 */
export function furnitureFootprint(
  position: Vec2,
  kind: string,
  rotationY: number,
  scale = 1,
): Rect {
  const dims: Record<string, [number, number]> = {
    desk: [1.6, 0.8],
    chair: [0.6, 0.6],
    monitor: [1.1, 0.25],
    shelf: [1.2, 0.45],
    sofa: [2.1, 0.9],
    'coffee-table': [1.1, 0.6],
    'meeting-table': [3.2, 1.4],
    whiteboard: [2.0, 0.12],
    plant: [0.6, 0.6],
    counter: [2.6, 0.8],
    credenza: [1.8, 0.5],
    'server-rack': [0.8, 1.1],
    bench: [2.0, 0.5],
    stool: [0.45, 0.45],
    'video-wall': [4.2, 0.2],
    'elevator-door': [2.4, 0.15],
    stair: [3.4, 3.6],
    turnstile: [0.9, 0.9],
    rug: [2.6, 1.8],
  };
  const [w, d] = dims[kind] ?? [0.8, 0.8];
  const quarterTurn = Math.abs(Math.sin(rotationY)) > 0.7;
  return {
    x: position.x,
    z: position.z,
    width: (quarterTurn ? d : w) * scale,
    depth: (quarterTurn ? w : d) * scale,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function findFloor(building: Building, floorId: string): Floor | undefined {
  return building.floors.find((floor) => floor.id === floorId);
}

export function findRoom(building: Building, roomId: string): Room | undefined {
  for (const floor of building.floors) {
    const room = floor.rooms.find((candidate) => candidate.id === roomId);
    if (room) return room;
  }
  return undefined;
}

export function findFloorOfRoom(building: Building, roomId: string): Floor | undefined {
  return building.floors.find((floor) => floor.rooms.some((room) => room.id === roomId));
}

export function allRooms(building: Building): Room[] {
  return building.floors.flatMap((floor) => floor.rooms);
}

export function allWorkstations(building: Building) {
  return building.floors.flatMap((floor) => floor.rooms.flatMap((room) => room.workstations));
}

export function roomWorkstation(room: Room, workstationId: string) {
  return room.workstations.find((ws) => ws.id === workstationId);
}
