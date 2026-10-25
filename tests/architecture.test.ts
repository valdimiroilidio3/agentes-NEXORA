import { describe, expect, it } from 'vitest';
import buildingFixture from '@/data/building.json';
import { loadBuilding } from '@/domain/building';
import {
  buildCeilingLights,
  buildDoors,
  buildFloorBase,
  buildRoomCeiling,
  buildWalls,
  floorFinishMaterial,
  isGlassyRoom,
} from '@/scene/architecture';
import { buildEndFacade, buildFacadeFins, buildFloorFacade, buildRoof, buildSite, entranceXFor } from '@/scene/facade';
import { computeCameraPose, buildingHeight } from '@/scene/camera';
import { doorPoint, rectBounds } from '@/domain/space';

const { building } = loadBuilding(buildingFixture);
const floor1 = building.floors[1]!;

function near(a: number, b: number, epsilon = 0.02): boolean {
  return Math.abs(a - b) <= epsilon;
}

describe('wall generation', () => {
  const walls = buildWalls(building, floor1);

  it('produces walls inside the floor plate', () => {
    expect(walls.length).toBeGreaterThan(20);
    for (const wall of walls) {
      expect(wall.size[0]).toBeGreaterThan(0);
      expect(wall.size[1]).toBeGreaterThan(0);
      const halfWidth = building.footprint.width / 2;
      expect(Math.abs(wall.position[0]) + wall.size[0] / 2).toBeLessThanOrEqual(halfWidth + 0.01);
      expect(Math.abs(wall.position[2]) + wall.size[2] / 2).toBeLessThanOrEqual(building.footprint.depth / 2 + 0.01);
    }
  });

  it('de-duplicates shared walls', () => {
    const keys = walls.map((wall) => `${wall.position[0]}:${wall.position[2]}:${wall.size[0]}:${wall.size[2]}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('leaves a doorway gap in every corridor wall', () => {
    for (const room of floor1.rooms) {
      const point = doorPoint(room);
      const doorAxisX = room.door.edge === 'north' || room.door.edge === 'south';
      const blockers = walls.filter((wall) => {
        if (doorAxisX) {
          const overlapsX = Math.abs(wall.position[0] - point.x) < room.door.width / 2 - 0.05;
          const atWall = Math.abs(wall.position[2] - point.z) < 0.2;
          const intersectsDoorHeight = wall.position[1] - wall.size[1] / 2 < 2.0;
          return overlapsX && atWall && intersectsDoorHeight;
        }
        const overlapsZ = Math.abs(wall.position[2] - point.z) < room.door.width / 2 - 0.05;
        const atWall = Math.abs(wall.position[0] - point.x) < 0.2;
        const intersectsDoorHeight = wall.position[1] - wall.size[1] / 2 < 2.0;
        return overlapsZ && atWall && intersectsDoorHeight;
      });
      expect(blockers, `doorway of ${room.id}`).toEqual([]);
    }
  });

  it('builds a header above each doorway', () => {
    const headers = walls.filter((wall) => wall.position[1] - wall.size[1] / 2 >= 2.0 - 0.001);
    expect(headers.length).toBeGreaterThanOrEqual(floor1.rooms.length);
  });

  it('uses glass partitions for the corridor wall of glazed rooms', () => {
    const glass = walls.filter((wall) => wall.material === 'glassPartition');
    expect(glass.length).toBeGreaterThan(0);
    const glazedRoom = floor1.rooms.find((room) => isGlassyRoom(room.template));
    expect(glazedRoom).toBeTruthy();
  });
});

describe('doors, slabs and lighting', () => {
  it('places a frame and a leaf for every room', () => {
    const doors = buildDoors(floor1);
    const leaves = doors.filter((door) => door.id.endsWith('-leaf'));
    expect(leaves).toHaveLength(floor1.rooms.length);
    for (const leaf of doors) {
      expect(Number.isFinite(leaf.position[0])).toBe(true);
      expect(Number.isFinite(leaf.rotationY ?? 0)).toBe(true);
    }
  });

  it('creates one slab and a finish per room', () => {
    const base = buildFloorBase(building, floor1);
    expect(base.some((box) => box.id === `${floor1.id}-slab`)).toBe(true);
    for (const room of floor1.rooms) {
      expect(base.some((box) => box.id === `${room.id}-finish`)).toBe(true);
    }
  });

  it('keeps columns clear of door openings', () => {
    const base = buildFloorBase(building, floor1);
    const columns = base.filter((box) => box.id.includes('-column-'));
    expect(columns.length).toBeGreaterThan(0);
    for (const room of floor1.rooms) {
      const door = doorPoint(room);
      for (const column of columns) {
        const sameLine = near(column.position[2], door.z, 2.0);
        if (sameLine) {
          expect(Math.abs(column.position[0] - door.x)).toBeGreaterThan(0.85);
        }
      }
    }
  });

  it('hangs lights below the ceiling', () => {
    const lights = buildCeilingLights(floor1);
    expect(lights.length).toBeGreaterThanOrEqual(floor1.rooms.length);
    for (const light of lights) {
      expect(light.position[1]).toBeLessThan(floor1.elevation + floor1.ceilingHeight);
    }
  });

  it('only builds a ceiling for the focused room', () => {
    const room = floor1.rooms[0]!;
    const ceiling = buildRoomCeiling(room, floor1);
    expect(ceiling[0]?.position[1]).toBeCloseTo(floor1.elevation + room.ceilingHeight, 5);
    expect(ceiling[0]?.size[0]).toBeCloseTo(room.rect.width, 5);
  });

  it('maps templates to distinct floor finishes', () => {
    expect(floorFinishMaterial('reception')).toBe('stone');
    expect(floorFinishMaterial('open-workspace')).toBe('carpet');
    expect(floorFinishMaterial('lab')).toBe('resin');
  });
});

describe('facade and site', () => {
  it('builds a spandrel band on both long facades per floor', () => {
    const boxes = buildFloorFacade(building, floor1);
    expect(boxes.filter((box) => box.id.endsWith('-spandrel'))).toHaveLength(2);
    expect(boxes.some((box) => box.material === 'glass')).toBe(true);
  });

  it('skips the entrance bay on the ground-floor north facade', () => {
    const ground = building.floors[0]!;
    const entranceX = entranceXFor(building);
    const boxes = buildFloorFacade(building, ground, { entranceX });
    const northGlass = boxes.filter((box) => box.id.includes('-north-glass-'));
    expect(northGlass.some((box) => Math.abs(box.position[0] - entranceX) < 2.4)).toBe(false);
  });

  it('hides the camera-facing facade on request (cutaway)', () => {
    const boxes = buildFloorFacade(building, floor1, { hideNorth: true });
    expect(boxes.some((box) => box.id.includes('-north-spandrel'))).toBe(false);
    expect(boxes.some((box) => box.id.includes('-south-spandrel'))).toBe(true);
  });

  it('hides the south facade on request (cutaway)', () => {
    const boxes = buildFloorFacade(building, floor1, { hideSouth: true });
    expect(boxes.some((box) => box.id.includes('-south-spandrel'))).toBe(false);
    expect(boxes.some((box) => box.id.includes('-north-spandrel'))).toBe(true);
  });

  it('builds end facades with ribbon windows', () => {
    const boxes = buildEndFacade(building, floor1);
    expect(boxes.filter((box) => box.material === 'glass')).toHaveLength(2);
  });

  it('creates fins, roof and site geometry', () => {
    expect(buildFacadeFins(building)).toHaveLength(16);
    const roof = buildRoof(building);
    expect(roof.some((box) => box.id === 'roof-slab')).toBe(true);
    const top = buildingHeight(building);
    expect(roof[0]!.position[1]).toBeGreaterThan(top);
    const site = buildSite(building);
    expect(site.length).toBeGreaterThan(10);
    expect(site.some((box) => box.id === 'site-plinth')).toBe(true);
  });
});

describe('camera poses', () => {
  it('frames the building from outside', () => {
    const pose = computeCameraPose(building, { viewMode: 'exterior', selectedRoomId: null, isolatedFloorId: null });
    expect(pose.position[1]).toBeGreaterThan(buildingHeight(building) * 0.5);
    expect(pose.target[1]).toBeGreaterThan(0);
    expect(pose.fov).toBeGreaterThan(20);
    expect(pose.fov).toBeLessThan(70);
  });

  it('targets the isolated floor elevation', () => {
    const floor = building.floors[3]!;
    const pose = computeCameraPose(building, {
      viewMode: 'floor',
      selectedRoomId: null,
      isolatedFloorId: floor.id,
    });
    expect(pose.target[1]).toBeGreaterThanOrEqual(floor.elevation);
    expect(pose.target[1]).toBeLessThan(floor.elevation + 5);
  });

  it('centres the room pose on the selected room', () => {
    const room = floor1.rooms.find((candidate) => candidate.template === 'creative-studio') ?? floor1.rooms[0]!;
    const pose = computeCameraPose(building, {
      viewMode: 'room',
      selectedRoomId: room.id,
      isolatedFloorId: room.floorId,
    });
    expect(pose.target[0]).toBeCloseTo(room.rect.x, 5);
    expect(pose.target[2]).toBeCloseTo(room.rect.z, 5);
    const bounds = rectBounds(room.rect);
    expect(pose.position[1]).toBeGreaterThan(floor1.elevation + floor1.ceilingHeight - 1);
    expect(pose.position[2]).toBeGreaterThan(bounds.maxZ);
  });

  it('falls back gracefully when the room is missing', () => {
    const pose = computeCameraPose(building, {
      viewMode: 'room',
      selectedRoomId: 'does-not-exist',
      isolatedFloorId: null,
    });
    expect(Number.isFinite(pose.position[0])).toBe(true);
    expect(pose.target[0]).toBe(0);
  });

  it('scales the room distance with room size', () => {
    const small = floor1.rooms.find((room) => room.rect.width < 8)!;
    const large = floor1.rooms.find((room) => room.rect.width > 10)!;
    const smallPose = computeCameraPose(building, { viewMode: 'room', selectedRoomId: small.id, isolatedFloorId: null });
    const largePose = computeCameraPose(building, { viewMode: 'room', selectedRoomId: large.id, isolatedFloorId: null });
    const smallDistance = Math.hypot(
      smallPose.position[0] - smallPose.target[0],
      smallPose.position[2] - smallPose.target[2],
    );
    const largeDistance = Math.hypot(
      largePose.position[0] - largePose.target[0],
      largePose.position[2] - largePose.target[2],
    );
    expect(largeDistance).toBeGreaterThan(smallDistance);
  });
});
