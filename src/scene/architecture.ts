/**
 * Procedural architecture.
 *
 * Pure functions that turn the spatial model into box specifications; no
 * Three.js objects are created here, so the output can be unit tested and the
 * React layer stays declarative. Coordinates are world metres.
 */
import type { Building, Floor, Room, RoomTemplateId, WallEdge } from '@/domain/types';
import { rectBounds } from '@/domain/space';
import type { MaterialKey } from './materials';

export interface BoxSpec {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly material: MaterialKey;
  readonly rotationY?: number;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

const WALL_HEAD = 2.12;
const DOOR_LEAF_HEIGHT = 2.08;

const finishByTemplate: Record<RoomTemplateId, MaterialKey> = {
  reception: 'stone',
  'operations-center': 'carpet',
  'open-workspace': 'carpet',
  'private-office': 'wood',
  'executive-office': 'wood',
  'meeting-room': 'carpet',
  'creative-studio': 'resin',
  lab: 'resin',
  lounge: 'wood',
  core: 'stone',
  security: 'resin',
};

const glassTemplates = new Set<RoomTemplateId>([
  'meeting-room',
  'private-office',
  'executive-office',
  'lab',
  'creative-studio',
  'security',
]);

export function floorFinishMaterial(template: RoomTemplateId): MaterialKey {
  return finishByTemplate[template];
}

export function isGlassyRoom(template: RoomTemplateId): boolean {
  return glassTemplates.has(template);
}

interface Opening {
  readonly from: number;
  readonly to: number;
  readonly height: number;
}

interface WallRun {
  readonly id: string;
  readonly axis: 'x' | 'z';
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly thickness: number;
  readonly height: number;
  readonly glass: boolean;
  readonly openings: Opening[];
  readonly elevation: number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

interface WallGeometry {
  readonly axis: 'x' | 'z';
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly thickness: number;
  readonly height: number;
  readonly glass: boolean;
}

function edgeWall(
  room: Room,
  edge: WallEdge,
  height: number,
  thickness: number,
  glass: boolean,
): WallGeometry {
  const bounds = rectBounds(room.rect);
  switch (edge) {
    case 'north':
      return { axis: 'x', at: bounds.minZ, from: bounds.minX, to: bounds.maxX, thickness, height, glass };
    case 'south':
      return { axis: 'x', at: bounds.maxZ, from: bounds.minX, to: bounds.maxX, thickness, height, glass };
    case 'west':
      return { axis: 'z', at: bounds.minX, from: bounds.minZ, to: bounds.maxZ, thickness, height, glass };
    case 'east':
      return { axis: 'z', at: bounds.maxX, from: bounds.minZ, to: bounds.maxZ, thickness, height, glass };
  }
}

const EDGES: readonly WallEdge[] = ['north', 'south', 'east', 'west'];

/** Interior walls with shared edges de-duplicated and door openings applied. */
export function buildWalls(building: Building, floor: Floor): BoxSpec[] {
  const walls = new Map<string, WallRun>();
  const doorOpenings: Array<{ axis: 'x' | 'z'; at: number; from: number; to: number; height: number }> = [];
  const height = floor.ceilingHeight;
  const thickness = building.interiorWallThickness;

  for (const room of floor.rooms) {
    for (const edge of EDGES) {
      if (room.exteriorWalls.includes(edge)) continue;
      const facesCorridor = edge === room.door.edge;
      const geometry = edgeWall(room, edge, height, thickness, facesCorridor && isGlassyRoom(room.template));
      const key = `${geometry.axis}:${round(geometry.at)}:${round(geometry.from)}:${round(geometry.to)}`;
      const existing = walls.get(key);
      if (!existing) {
        walls.set(key, {
          id: `wall-${floor.id}-${key}`,
          axis: geometry.axis,
          at: geometry.at,
          from: geometry.from,
          to: geometry.to,
          thickness: geometry.thickness,
          height: geometry.height,
          glass: geometry.glass,
          openings: [],
          elevation: floor.elevation,
        });
      }

      if (facesCorridor) {
        const centre =
          geometry.axis === 'x' ? room.rect.x + room.door.offset : room.rect.z + room.door.offset;
        doorOpenings.push({
          axis: geometry.axis,
          at: geometry.at,
          from: centre - room.door.width / 2,
          to: centre + room.door.width / 2,
          height: WALL_HEAD,
        });
      }
    }
  }

  for (const opening of doorOpenings) {
    for (const wall of walls.values()) {
      if (wall.axis !== opening.axis) continue;
      if (Math.abs(wall.at - opening.at) > 0.001) continue;
      if (opening.from < wall.from - 0.001 || opening.to > wall.to + 0.001) continue;
      wall.openings.push({ from: opening.from, to: opening.to, height: opening.height });
    }
  }

  const boxes: BoxSpec[] = [];
  for (const wall of walls.values()) {
    const segments: Array<{ from: number; to: number; y: number; h: number; suffix: string }> = [];
    const openings = [...wall.openings].sort((a, b) => a.from - b.from);
    let cursor = wall.from;
    for (const opening of openings) {
      if (opening.from > cursor + 0.002) {
        segments.push({ from: cursor, to: opening.from, y: 0, h: wall.height, suffix: 'a' });
      }
      if (opening.height < wall.height - 0.001) {
        segments.push({
          from: opening.from,
          to: opening.to,
          y: opening.height,
          h: wall.height - opening.height,
          suffix: 'h',
        });
      }
      cursor = Math.max(cursor, opening.to);
    }
    if (cursor < wall.to - 0.002) {
      segments.push({ from: cursor, to: wall.to, y: 0, h: wall.height, suffix: 'b' });
    }

    for (const segment of segments) {
      const length = segment.to - segment.from;
      if (length <= 0.01) continue;
      const mid = (segment.from + segment.to) / 2;
      const y = wall.elevation + segment.y + segment.h / 2;
      boxes.push({
        id: `${wall.id}-${segment.suffix}-${round(segment.from)}`,
        position:
          wall.axis === 'x'
            ? [mid, y, wall.at]
            : [wall.at, y, mid],
        size:
          wall.axis === 'x'
            ? [length, segment.h, wall.thickness]
            : [wall.thickness, segment.h, length],
        material: wall.glass ? 'glassPartition' : 'plaster',
        receiveShadow: true,
      });
    }
  }
  return boxes;
}

/** Door frames and opened leaves for every room entrance. */
export function buildDoors(floor: Floor): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  for (const room of floor.rooms) {
    const { axis, at, from, to, centre, swing } = doorGeometry(room);
    const width = to - from;
    const frame = 0.06;
    const baseY = floor.elevation;

    if (axis === 'x') {
      boxes.push({
        id: `${room.id}-jamb-a`,
        position: [from + frame / 2, baseY + WALL_HEAD / 2, at],
        size: [frame, WALL_HEAD, 0.2],
        material: 'metal',
      });
      boxes.push({
        id: `${room.id}-jamb-b`,
        position: [to - frame / 2, baseY + WALL_HEAD / 2, at],
        size: [frame, WALL_HEAD, 0.2],
        material: 'metal',
      });
      boxes.push({
        id: `${room.id}-lintel`,
        position: [centre, baseY + WALL_HEAD - frame / 2, at],
        size: [width, frame, 0.2],
        material: 'metal',
      });
    } else {
      boxes.push({
        id: `${room.id}-jamb-a`,
        position: [at, baseY + WALL_HEAD / 2, from + frame / 2],
        size: [0.2, WALL_HEAD, frame],
        material: 'metal',
      });
      boxes.push({
        id: `${room.id}-jamb-b`,
        position: [at, baseY + WALL_HEAD / 2, to - frame / 2],
        size: [0.2, WALL_HEAD, frame],
        material: 'metal',
      });
      boxes.push({
        id: `${room.id}-lintel`,
        position: [at, baseY + WALL_HEAD - frame / 2, centre],
        size: [0.2, frame, width],
        material: 'metal',
      });
    }

    // Door leaf, hinged at the "from" edge and opened 34° into the room.
    const angle = (axis === 'x' ? swing : -swing) * (34 * Math.PI) / 180;
    const leafLength = Math.max(0.6, width - 0.08);
    if (axis === 'x') {
      const hinge = from + 0.04;
      boxes.push({
        id: `${room.id}-leaf`,
        position: [
          hinge + (Math.cos(angle) * leafLength) / 2,
          baseY + DOOR_LEAF_HEIGHT / 2,
          at - (Math.sin(angle) * leafLength) / 2,
        ],
        size: [leafLength, DOOR_LEAF_HEIGHT, 0.045],
        material: isGlassyRoom(room.template) ? 'glassPartition' : 'wood',
        rotationY: angle,
      });
    } else {
      // Leaf hinged at the "from" edge of a wall that runs along z.
      boxes.push({
        id: `${room.id}-leaf`,
        position: [
          at + (Math.sin(angle) * leafLength) / 2,
          baseY + DOOR_LEAF_HEIGHT / 2,
          from + (Math.cos(angle) * leafLength) / 2,
        ],
        size: [leafLength, DOOR_LEAF_HEIGHT, 0.045],
        material: 'wood',
        rotationY: -Math.PI / 2 + angle,
      });
    }
  }
  return boxes;
}

function doorGeometry(room: Room) {
  const bounds = rectBounds(room.rect);
  const axis: 'x' | 'z' = room.door.edge === 'north' || room.door.edge === 'south' ? 'x' : 'z';
  if (axis === 'x') {
    const at = room.door.edge === 'north' ? bounds.minZ : bounds.maxZ;
    const centre = room.rect.x + room.door.offset;
    return {
      axis,
      at,
      from: centre - room.door.width / 2,
      to: centre + room.door.width / 2,
      centre,
      // Positive rotation swings the leaf towards -z (into a north-band room).
      swing: room.rect.z < 0 ? 1 : -1,
    };
  }
  const at = room.door.edge === 'west' ? bounds.minX : bounds.maxX;
  const centre = room.rect.z + room.door.offset;
  return {
    axis,
    at,
    from: centre - room.door.width / 2,
    to: centre + room.door.width / 2,
    centre,
    swing: room.rect.x < 0 ? 1 : -1,
  };
}

/** Floor slab, room finishes, corridor finish and structural columns. */
export function buildFloorBase(building: Building, floor: Floor): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  const { width, depth } = building.footprint;
  const elevation = floor.elevation;

  boxes.push({
    id: `${floor.id}-slab`,
    position: [0, elevation - building.slabThickness / 2, 0],
    size: [width, building.slabThickness, depth],
    material: 'concrete',
    receiveShadow: true,
    castShadow: true,
  });

  const corridorDepth = building.corridorDepth;
  boxes.push({
    id: `${floor.id}-corridor-finish`,
    position: [0, elevation + 0.012, 0],
    size: [width - building.exteriorWallThickness * 2, 0.024, corridorDepth],
    material: 'stone',
    receiveShadow: true,
  });

  // A restrained brass wayfinding line down the middle of every corridor.
  boxes.push({
    id: `${floor.id}-corridor-line`,
    position: [0, elevation + 0.028, 0],
    size: [width - building.exteriorWallThickness * 2 - 2, 0.006, 0.05],
    material: 'wood',
  });

  for (const room of floor.rooms) {
    boxes.push({
      id: `${room.id}-finish`,
      position: [room.rect.x, elevation + 0.014, room.rect.z],
      size: [room.rect.width - 0.12, 0.028, room.rect.depth - 0.12],
      material: floorFinishMaterial(room.template),
      receiveShadow: true,
    });
  }

  // Structural columns on the corridor grid, skipping door openings.
  const bay = 5.8;
  const halfInterior = width / 2 - building.exteriorWallThickness;
  const doorXs = floor.rooms
    .filter((room) => room.door.edge === 'north' || room.door.edge === 'south')
    .map((room) => room.rect.x + room.door.offset);
  for (let x = -halfInterior + bay; x < halfInterior - 0.5; x += bay) {
    if (doorXs.some((doorX) => Math.abs(doorX - x) < 0.9)) continue;
    for (const z of [-corridorDepth / 2, corridorDepth / 2]) {
      boxes.push({
        id: `${floor.id}-column-${round(x)}-${round(z)}`,
        position: [x, elevation + floor.ceilingHeight / 2, z],
        size: [0.4, floor.ceilingHeight, 0.4],
        material: 'concrete',
        castShadow: true,
        receiveShadow: true,
      });
    }
  }

  return boxes;
}

/** Suspended linear light fixtures (emissive only, no extra real lights). */
export function buildCeilingLights(floor: Floor): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  for (const room of floor.rooms) {
    const count = room.rect.width > 12 ? 3 : room.rect.width > 8 ? 2 : 1;
    for (let index = 0; index < count; index += 1) {
      const offset = count === 1 ? 0 : (index - (count - 1) / 2) * (room.rect.width / (count + 0.4));
      boxes.push({
        id: `${room.id}-light-${index}`,
        position: [
          room.rect.x + offset,
          floor.elevation + room.ceilingHeight - 0.14,
          room.rect.z,
        ],
        size: [Math.min(2.4, room.rect.width / (count + 0.8)), 0.06, 0.16],
        material: 'light',
      });
    }
  }
  return boxes;
}

/** Ceiling plane for the room currently in focus (kept out of cutaway views). */
export function buildRoomCeiling(room: Room, floor: Floor): BoxSpec[] {
  const boxes: BoxSpec[] = [
    {
      id: `${room.id}-ceiling`,
      position: [room.rect.x, floor.elevation + room.ceilingHeight, room.rect.z],
      size: [room.rect.width, 0.08, room.rect.depth],
      material: 'plaster',
      receiveShadow: true,
    },
  ];
  for (let index = 0; index < 2; index += 1) {
    boxes.push({
      id: `${room.id}-ceiling-strip-${index}`,
      position: [
        room.rect.x + (index === 0 ? -room.rect.width * 0.22 : room.rect.width * 0.22),
        floor.elevation + room.ceilingHeight - 0.05,
        room.rect.z,
      ],
      size: [Math.min(3.2, room.rect.width * 0.3), 0.05, 0.18],
      material: 'light',
    });
  }
  return boxes;
}
