import { describe, expect, it } from 'vitest';
import buildingFixture from '@/data/building.json';
import { buildBuilding } from '@/domain/building';
import { parseBuildingConfig } from '@/domain/schema';
import {
  doorClearanceRect,
  doorPoint,
  insetRect,
  interiorRect,
  pointInRect,
  rectsOverlap,
  rectContainsRect,
  validateBuilding,
} from '@/domain/space';
import type { Building, Floor, Room } from '@/domain/types';
import { mutable, type DeepMutable } from './support';

const config = parseBuildingConfig(buildingFixture);
const building = buildBuilding(config);

function cloneBuilding(): Building {
  return JSON.parse(JSON.stringify(building)) as Building;
}

function firstRoom(
  target: DeepMutable<Building>,
  floorIndex = 1,
): { floor: DeepMutable<Floor>; room: DeepMutable<Room> } {
  const floor = target.floors[floorIndex]!;
  return { floor, room: floor.rooms[0]! };
}

describe('rectangle maths', () => {
  it('detects overlap but tolerates touching edges', () => {
    const a = { x: 0, z: 0, width: 2, depth: 2 };
    const b = { x: 1.5, z: 0, width: 2, depth: 2 };
    const touching = { x: 2, z: 0, width: 2, depth: 2 };
    expect(rectsOverlap(a, b)).toBe(true);
    expect(rectsOverlap(a, touching)).toBe(false);
  });

  it('checks containment and insets', () => {
    const outer = { x: 0, z: 0, width: 10, depth: 6 };
    const inner = { x: 0, z: 0, width: 8, depth: 4 };
    expect(rectContainsRect(outer, inner)).toBe(true);
    expect(rectContainsRect(inner, outer)).toBe(false);
    expect(insetRect(outer, 1).width).toBe(8);
    expect(pointInRect({ x: 0, z: 0 }, outer)).toBe(true);
    expect(pointInRect({ x: 5.1, z: 0 }, outer)).toBe(false);
  });
});

describe('fixture integrity', () => {
  it('compiles five floors with unique room ids', () => {
    expect(building.floors).toHaveLength(5);
    const ids = building.floors.flatMap((floor) => floor.rooms.map((room) => room.id));
    expect(new Set(ids).size).toBe(ids.length);
    const elevations = building.floors.map((floor) => floor.elevation);
    [0, 4.2, 8.4, 12.6, 16.8].forEach((expected, index) => {
      expect(elevations[index]).toBeCloseTo(expected, 6);
    });
  });

  it('passes spatial validation', () => {
    const result = validateBuilding(building);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('gives every room a door that reaches the corridor', () => {
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        const point = doorPoint(room);
        const bounds = room.rect;
        if (room.door.edge === 'south') {
          expect(bounds.z + bounds.depth / 2).toBeLessThanOrEqual(0.001);
        } else if (room.door.edge === 'north') {
          expect(bounds.z - bounds.depth / 2).toBeGreaterThanOrEqual(-0.001);
        }
        expect(Math.abs(room.door.offset) + room.door.width / 2).toBeLessThanOrEqual(
          (room.door.edge === 'north' || room.door.edge === 'south' ? room.rect.width : room.rect.depth) / 2 + 1e-9,
        );
        expect(Number.isFinite(point.x) && Number.isFinite(point.z)).toBe(true);
      }
    }
  });

  it('keeps every door clearance inside its room', () => {
    const interior = interiorRect(building);
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        const clearance = doorClearanceRect(room);
        expect(clearance.width).toBeGreaterThan(0);
        expect(rectContainsRect(interior, room.rect, 0.01)).toBe(true);
      }
    }
  });
});

describe('spatial validation catches real defects', () => {
  it('rejects overlapping rooms', () => {
    const broken = mutable(cloneBuilding());
    const floor = broken.floors[1]!;
    const a = floor.rooms[0]!;
    const b = floor.rooms[1]!;
    b.rect = { ...b.rect, x: a.rect.x + 0.4, z: a.rect.z, width: 4, depth: 4 };
    const result = validateBuilding(broken);
    expect(result.errors.some((issue) => issue.code === 'room.overlap')).toBe(true);
  });

  it('rejects inconsistent floor elevation', () => {
    const broken = mutable(cloneBuilding());
    broken.floors[2]!.elevation = 9.5;
    const result = validateBuilding(broken);
    expect(result.errors.some((issue) => issue.code === 'floor.elevation')).toBe(true);
  });

  it('rejects a room that leaves the floor plate', () => {
    const broken = mutable(cloneBuilding());
    const { room } = firstRoom(broken, 1);
    room.rect = { ...room.rect, x: 30, width: 12 };
    const result = validateBuilding(broken);
    expect(result.errors.some((issue) => issue.code === 'room.outOfBounds')).toBe(true);
  });

  it('rejects furniture outside its room', () => {
    const broken = mutable(cloneBuilding());
    const { room } = firstRoom(broken, 2);
    const item = room.furniture[0]!;
    item.position = { x: room.rect.x + 40, z: room.rect.z };
    const result = validateBuilding(broken);
    expect(result.errors.some((issue) => issue.code === 'furniture.outOfBounds')).toBe(true);
  });

  it('rejects furniture blocking a doorway', () => {
    const broken = mutable(cloneBuilding());
    const { room } = firstRoom(broken, 1);
    const point = doorPoint(room);
    const target = room.furniture.find((item) => item.kind === 'plant') ?? room.furniture[0]!;
    target.position = { x: point.x, z: point.z + (room.rect.z < 0 ? -0.6 : 0.6) };
    const result = validateBuilding(broken);
    expect(result.errors.some((issue) => issue.code === 'furniture.blocksDoor')).toBe(true);
  });

  it('rejects a workstation that leaves its room', () => {
    const broken = mutable(cloneBuilding());
    const { room } = firstRoom(broken, 3);
    const station = room.workstations[0];
    if (!station) return;
    station.position = { x: room.rect.x + 60, z: room.rect.z };
    const result = validateBuilding(broken);
    expect(result.errors.some((issue) => issue.code === 'workstation.outOfBounds')).toBe(true);
  });
});
