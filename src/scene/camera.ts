/**
 * Camera choreography.
 *
 * Given the application's view state, produce the pose the camera should
 * settle into. The rig interpolates towards it, and any user interaction
 * cancels the interpolation immediately, so navigation is always
 * interruptible and predictable.
 */
import type { Building, ViewMode } from '@/domain/types';
import { clamp } from '@/domain/space';

export interface CameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
}

export interface CameraContext {
  readonly viewMode: ViewMode;
  readonly selectedRoomId: string | null;
  readonly isolatedFloorId: string | null;
}

export function buildingHeight(building: Building): number {
  return building.floors.length * building.floorHeight;
}

export function computeCameraPose(building: Building, context: CameraContext): CameraPose {
  const height = buildingHeight(building);
  const { width, depth } = building.footprint;

  if (context.viewMode === 'exterior') {
    // The main entrance faces north, so the default exterior view approaches
    // from the north-east.
    return {
      position: [width * 1.15, height * 1.4 + 5, -depth * 2.55],
      target: [0, height * 0.42, 0],
      fov: 36,
    };
  }

  if (context.viewMode === 'room' && context.selectedRoomId) {
    const found = findRoom(building, context.selectedRoomId);
    if (found) {
      const { room, floor } = found;
      const span = Math.max(room.rect.width, room.rect.depth);
      const distance = clamp(span * 2.1, 9, 20);
      return {
        position: [
          room.rect.x + distance * 0.55,
          floor.elevation + room.ceilingHeight + distance * 0.45,
          room.rect.z + distance * 0.95,
        ],
        target: [room.rect.x, floor.elevation + 0.9, room.rect.z],
        fov: 38,
      };
    }
  }

  if (context.viewMode === 'floor' && context.isolatedFloorId) {
    const floor = building.floors.find((candidate) => candidate.id === context.isolatedFloorId);
    if (floor) {
      return {
        position: [width * 0.55, floor.elevation + 15.5, depth * 1.45],
        target: [0, floor.elevation + 0.8, 0],
        fov: 40,
      };
    }
  }

  return {
    position: [width * 0.95, height * 1.1 + 3, -depth * 2.2],
    target: [0, height * 0.38, 0],
    fov: 38,
  };
}

function findRoom(building: Building, roomId: string) {
  for (const floor of building.floors) {
    const room = floor.rooms.find((candidate) => candidate.id === roomId);
    if (room) return { room, floor };
  }
  return null;
}

/** Limits applied to the orbit controls. */
export function cameraLimits(building: Building) {
  return {
    minDistance: 5,
    maxDistance: Math.max(80, buildingHeight(building) * 4.2),
    maxPolarAngle: Math.PI * 0.495,
    minPolarAngle: 0.08,
  };
}
