/**
 * Exterior envelope: curtain walls, ribbons, mullions, roof, plaza and the
 * building's entrance. Pure box specifications, like `architecture.ts`.
 */
import type { Building, Floor } from '@/domain/types';
import type { BoxSpec } from './architecture';

const BAY = 2.9;

export interface FacadeOptions {
  /** Ground-floor entrance position on the north facade. */
  readonly entranceX?: number;
  readonly hideNorth?: boolean;
  readonly hideSouth?: boolean;
}

export function entranceXFor(building: Building): number {
  const ground = building.floors[0];
  const reception = ground?.rooms.find((room) => room.template === 'reception');
  return reception?.rect.x ?? 0;
}

/** Curtain wall for one floor on the long (north/south) facades. */
export function buildFloorFacade(
  building: Building,
  floor: Floor,
  options: FacadeOptions = {},
): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  const { width } = building.footprint;
  const halfW = width / 2;
  const halfD = building.footprint.depth / 2;
  const spandrel = 0.65;
  const glassHeight = building.floorHeight - 1.05;
  const glassBottom = floor.elevation + spandrel;
  const glassCentreY = glassBottom + glassHeight / 2;
  const bays = Math.round((width - 1.2) / BAY);
  const bayWidth = (width - 1.2) / bays;
  const entranceX = options.entranceX ?? entranceXFor(building);

  for (const side of ['north', 'south'] as const) {
    if (side === 'north' && options.hideNorth) continue;
    if (side === 'south' && options.hideSouth) continue;
    const z = side === 'north' ? -halfD + 0.6 : halfD - 0.6;
    const outward = side === 'north' ? -1 : 1;

    // Spandrel band between storeys.
    boxes.push({
      id: `${floor.id}-${side}-spandrel`,
      position: [0, floor.elevation + spandrel / 2 + 0.02, z],
      size: [width, spandrel, 0.22],
      material: 'darkMetal',
      receiveShadow: true,
      castShadow: true,
    });

    // Vision glass, bay by bay, so the entrance can replace a panel.
    for (let bay = 0; bay < bays; bay += 1) {
      const centre = -halfW + 0.6 + bayWidth * (bay + 0.5);
      if (floor.index === 0 && side === 'north' && Math.abs(centre - entranceX) < 2.4) continue;
      boxes.push({
        id: `${floor.id}-${side}-glass-${bay}`,
        position: [centre, glassCentreY, z + outward * 0.02],
        size: [bayWidth - 0.08, glassHeight, 0.06],
        material: 'glass',
      });
    }

    // Mullions and a mid-height transom.
    for (let bay = 0; bay <= bays; bay += 1) {
      const x = -halfW + 0.6 + bayWidth * bay;
      boxes.push({
        id: `${floor.id}-${side}-mullion-${bay}`,
        position: [x, glassCentreY, z],
        size: [0.07, glassHeight, 0.2],
        material: 'metal',
      });
    }
    boxes.push({
      id: `${floor.id}-${side}-transom`,
      position: [0, glassBottom + glassHeight * 0.55, z],
      size: [width - 1.2, 0.06, 0.18],
      material: 'metal',
    });
  }

  return boxes;
}

/** Ribbon-window facades on the short ends. */
export function buildEndFacade(building: Building, floor: Floor): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  const { depth } = building.footprint;
  const halfW = building.footprint.width / 2;
  const ribbonBottom = floor.elevation + 0.95;
  const ribbonHeight = 2.0;
  const wallHeight = building.floorHeight - 0.35;

  for (const side of ['east', 'west'] as const) {
    const x = side === 'east' ? halfW - 0.3 : -halfW + 0.3;
    const sign = side === 'east' ? 1 : -1;
    boxes.push({
      id: `${floor.id}-${side}-wall-low`,
      position: [x, floor.elevation + ribbonBottom / 2 - floor.elevation / 2, 0],
      size: [0.6, ribbonBottom - floor.elevation, depth],
      material: 'concrete',
      castShadow: true,
      receiveShadow: true,
    });
    boxes.push({
      id: `${floor.id}-${side}-ribbon`,
      position: [x + sign * 0.31, ribbonBottom + ribbonHeight / 2, 0],
      size: [0.06, ribbonHeight, depth - 1.6],
      material: 'glass',
    });
    const topStart = ribbonBottom + ribbonHeight;
    boxes.push({
      id: `${floor.id}-${side}-wall-high`,
      position: [x, (topStart + floor.elevation + wallHeight) / 2, 0],
      size: [0.6, floor.elevation + wallHeight - topStart, depth],
      material: 'concrete',
      castShadow: true,
      receiveShadow: true,
    });
    for (let index = 0; index <= 5; index += 1) {
      const z = -(depth - 1.6) / 2 + ((depth - 1.6) / 5) * index;
      boxes.push({
        id: `${floor.id}-${side}-ribbon-mullion-${index}`,
        position: [x + sign * 0.33, ribbonBottom + ribbonHeight / 2, z],
        size: [0.08, ribbonHeight, 0.1],
        material: 'metal',
      });
    }
  }
  return boxes;
}

/** Vertical concrete fins that give the long facades a structural rhythm. */
export function buildFacadeFins(building: Building): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  const halfW = building.footprint.width / 2;
  const halfD = building.footprint.depth / 2;
  const totalHeight = building.floors.length * building.floorHeight;
  const count = 7;
  for (let index = 0; index <= count; index += 1) {
    const x = -halfW + 0.6 + ((building.footprint.width - 1.2) / count) * index;
    for (const side of ['north', 'south'] as const) {
      const z = side === 'north' ? -halfD - 0.12 : halfD + 0.12;
      boxes.push({
        id: `fin-${side}-${index}`,
        position: [x, totalHeight / 2 + 0.3, z],
        size: [0.16, totalHeight + 0.6, 0.34],
        material: 'concrete',
        castShadow: true,
      });
    }
  }
  return boxes;
}

export function buildRoof(building: Building): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  const { width, depth } = building.footprint;
  const top = building.floors.length * building.floorHeight;

  boxes.push({
    id: 'roof-slab',
    position: [0, top + 0.15, 0],
    size: [width, 0.3, depth],
    material: 'concrete',
    castShadow: true,
    receiveShadow: true,
  });
  boxes.push({
    id: 'roof-parapet-n',
    position: [0, top + 0.85, -depth / 2 + 0.2],
    size: [width, 1.1, 0.4],
    material: 'concrete',
    castShadow: true,
  });
  boxes.push({
    id: 'roof-parapet-s',
    position: [0, top + 0.85, depth / 2 - 0.2],
    size: [width, 1.1, 0.4],
    material: 'concrete',
    castShadow: true,
  });
  for (const side of ['east', 'west'] as const) {
    boxes.push({
      id: `roof-parapet-${side}`,
      position: [side === 'east' ? width / 2 - 0.2 : -width / 2 + 0.2, top + 0.85, 0],
      size: [0.4, 1.1, depth],
      material: 'concrete',
      castShadow: true,
    });
  }

  // Rooftop plant.
  boxes.push({
    id: 'roof-plant-1',
    position: [-7, top + 1.3, 2.5],
    size: [5.2, 2.0, 3.2],
    material: 'darkMetal',
    castShadow: true,
  });
  boxes.push({
    id: 'roof-plant-2',
    position: [6.5, top + 1.15, 1.5],
    size: [3.6, 1.7, 2.6],
    material: 'darkMetal',
    castShadow: true,
  });
  // Photovoltaic array.
  for (let index = 0; index < 5; index += 1) {
    boxes.push({
      id: `roof-pv-${index}`,
      position: [1 + index * 1.5, top + 0.5, -4.5],
      size: [1.3, 0.08, 3.2],
      material: 'screen',
      rotationY: 0.06,
    });
  }
  return boxes;
}

/** Ground plane, entrance plaza, canopy and landscaping. */
export function buildSite(building: Building): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  const { width, depth } = building.footprint;
  const halfD = depth / 2;
  const entranceX = entranceXFor(building);
  const ground = -0.42;

  boxes.push({
    id: 'site-plane',
    position: [0, ground - 0.1, 0],
    size: [220, 0.2, 220],
    material: 'asphalt',
    receiveShadow: true,
  });
  boxes.push({
    id: 'site-plinth',
    position: [0, ground + 0.2, 0],
    size: [width + 6, 0.5, depth + 6],
    material: 'paving',
    receiveShadow: true,
    castShadow: true,
  });
  // Entrance steps on the north side.
  for (let index = 0; index < 3; index += 1) {
    boxes.push({
      id: `entrance-step-${index}`,
      position: [entranceX, ground + 0.12 + index * 0.12, -halfD - 3.6 - index * 0.9],
      size: [12 - index * 0.4, 0.2 + index * 0.24, 1.9],
      material: 'paving',
      receiveShadow: true,
    });
  }
  boxes.push({
    id: 'entrance-canopy',
    position: [entranceX, 4.1, -halfD - 2.6],
    size: [13, 0.22, 5.4],
    material: 'darkMetal',
    castShadow: true,
  });
  for (const side of [-1, 1] as const) {
    boxes.push({
      id: `canopy-column-${side}`,
      position: [entranceX + side * 5.4, 2.0, -halfD - 4.6],
      size: [0.3, 4.0, 0.3],
      material: 'metal',
      castShadow: true,
    });
  }
  // Entrance frame and doors.
  for (const side of [-1, 1] as const) {
    boxes.push({
      id: `entrance-door-${side}`,
      position: [entranceX + side * 1.15, 1.7, -halfD + 0.62],
      size: [2.1, 3.4, 0.08],
      material: 'glass',
    });
    boxes.push({
      id: `entrance-frame-${side}`,
      position: [entranceX + side * 2.25, 1.75, -halfD + 0.58],
      size: [0.14, 3.5, 0.18],
      material: 'darkMetal',
      castShadow: true,
    });
  }
  boxes.push({
    id: 'entrance-header',
    position: [entranceX, 3.5, -halfD + 0.58],
    size: [4.6, 0.2, 0.2],
    material: 'darkMetal',
  });

  // Trees on the plaza.
  const treeSpots: Array<[number, number]> = [
    [-14, -halfD - 8],
    [-8, -halfD - 11],
    [12, -halfD - 8],
    [17, -halfD - 12],
    [-16, halfD + 8],
    [14, halfD + 9],
  ];
  treeSpots.forEach(([x, z], index) => {
    boxes.push({
      id: `tree-trunk-${index}`,
      position: [x, 1.1, z],
      size: [0.34, 2.6, 0.34],
      material: 'woodDark',
      castShadow: true,
    });
    boxes.push({
      id: `tree-crown-${index}`,
      position: [x, 3.4, z],
      size: [3.0, 2.8, 3.0],
      material: 'foliage',
      castShadow: true,
    });
  });

  // Planted edge along the frontage.
  boxes.push({
    id: 'lawn-north',
    position: [0, ground + 0.01, -halfD - 14],
    size: [46, 0.08, 8],
    material: 'lawn',
    receiveShadow: true,
  });
  return boxes;
}
