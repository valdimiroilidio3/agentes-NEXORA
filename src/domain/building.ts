/**
 * Compiles a validated building configuration into the spatial model the
 * scene consumes (rooms + generated furniture + workstation anchors), and
 * validates the result before anything is rendered.
 */
import type {
  Building,
  BuildingConfig,
  Floor,
  Room,
} from './types';
import { generateRoomContents } from './templates';
import { parseBuildingConfig } from './schema';
import { validateBuilding, type ValidationResult } from './space';

export interface BuildingLoadResult {
  readonly building: Building;
  readonly validation: ValidationResult;
}

export class BuildingValidationError extends Error {
  constructor(readonly validation: ValidationResult) {
    super(
      `Building configuration is invalid:\n- ${validation.errors
        .map((issue) => `[${issue.code}] ${issue.message}`)
        .join('\n- ')}`,
    );
    this.name = 'BuildingValidationError';
  }
}

export function buildBuilding(config: BuildingConfig): Building {
  const floors: Floor[] = config.floors
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((floorConfig) => {
      const elevation = floorConfig.index * config.building.floorHeight;
      const rooms: Room[] = floorConfig.rooms.map((roomConfig) => {
        const generated = generateRoomContents(roomConfig);
        return {
          id: roomConfig.id,
          floorId: floorConfig.id,
          name: roomConfig.name,
          code: roomConfig.code,
          template: roomConfig.template,
          purpose: roomConfig.purpose,
          rect: roomConfig.rect,
          ceilingHeight: roomConfig.ceilingHeight ?? floorConfig.ceilingHeight,
          door: roomConfig.door,
          capacity: generated.capacity,
          exteriorWalls: exteriorWallsFor(roomConfig.rect, config.building),
          furniture: generated.furniture,
          workstations: generated.workstations,
        };
      });
      return {
        id: floorConfig.id,
        index: floorConfig.index,
        name: floorConfig.name,
        department: floorConfig.department,
        elevation,
        ceilingHeight: floorConfig.ceilingHeight,
        footprint: { ...config.building.footprint },
        rooms,
      } satisfies Floor;
    });

  return {
    id: config.building.id,
    name: config.building.name,
    footprint: { ...config.building.footprint },
    floorHeight: config.building.floorHeight,
    slabThickness: config.building.slabThickness,
    corridorDepth: config.building.corridorDepth,
    interiorWallThickness: config.building.interiorWallThickness,
    exteriorWallThickness: config.building.exteriorWallThickness,
    floors,
  };
}

/** Walls of a room that sit on the building envelope and therefore get glazing. */
function exteriorWallsFor(
  rect: { x: number; z: number; width: number; depth: number },
  building: BuildingConfig['building'],
): Room['exteriorWalls'] {
  const halfW = building.footprint.width / 2 - building.exteriorWallThickness;
  const halfD = building.footprint.depth / 2 - building.exteriorWallThickness;
  const walls: Array<'north' | 'south' | 'east' | 'west'> = [];
  if (Math.abs(rect.z - rect.depth / 2 + halfD) < 0.01) walls.push('north');
  if (Math.abs(rect.z + rect.depth / 2 - halfD) < 0.01) walls.push('south');
  if (Math.abs(rect.x - rect.width / 2 + halfW) < 0.01) walls.push('west');
  if (Math.abs(rect.x + rect.width / 2 - halfW) < 0.01) walls.push('east');
  return walls;
}

/**
 * Full load path: validate the raw fixture, compile the model, then run the
 * spatial checks. Throws `BuildingValidationError` on hard errors so the UI
 * can show a real error state instead of a broken scene.
 */
export function loadBuilding(raw: unknown): BuildingLoadResult {
  const config = parseBuildingConfig(raw);
  const building = buildBuilding(config);
  const validation = validateBuilding(building);
  if (!validation.ok) throw new BuildingValidationError(validation);
  return { building, validation };
}
