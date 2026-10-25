/**
 * Static scene budget report.
 *
 *   npm run stats
 *
 * Counts what the renderer submits in each view so performance decisions are
 * based on measured structure. It does NOT measure frame rate: that needs a
 * real GPU, which this repository's CI does not provide.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBuilding } from '../src/domain/building';
import { buildCeilingLights, buildDoors, buildFloorBase, buildWalls } from '../src/scene/architecture';
import { buildEndFacade, buildFacadeFins, buildFloorFacade, buildRoof, buildSite } from '../src/scene/facade';
import { drawCallCount } from '../src/scene/SceneBoxes';
import type { Building, Floor } from '../src/domain/types';

const raw = JSON.parse(readFileSync(join(process.cwd(), 'src/data/building.json'), 'utf8')) as unknown;
const { building } = loadBuilding(raw);

const FURNITURE_MESHES: Record<string, number> = {
  desk: 8, chair: 4, monitor: 3, shelf: 6, sofa: 6, 'coffee-table': 5, 'meeting-table': 4,
  whiteboard: 3, plant: 3, counter: 3, credenza: 3, 'server-rack': 5, bench: 3, stool: 3,
  'video-wall': 3, 'elevator-door': 4, stair: 16, turnstile: 3, rug: 1,
};

interface FloorCost {
  shell: number;
  interior: number;
  agents: number;
}

function floorCost(building: Building, floor: Floor, options: { facade: boolean; hideNorth?: boolean; interior: boolean }): FloorCost {
  const specs = [
    ...buildFloorBase(building, floor),
    ...buildWalls(building, floor),
    ...buildDoors(floor),
    ...(options.facade
      ? [
          ...buildFloorFacade(building, floor, { hideNorth: options.hideNorth ?? false }),
          ...buildEndFacade(building, floor),
        ]
      : []),
  ];
  const shell = drawCallCount(specs);
  if (!options.interior) return { shell, interior: 0, agents: 0 };
  const lights = drawCallCount(buildCeilingLights(floor));
  const furniture = floor.rooms.reduce(
    (sum, room) => sum + room.furniture.reduce((n, item) => n + (FURNITURE_MESHES[item.kind] ?? 3), 0),
    0,
  );
  const seats = floor.rooms.reduce((sum, room) => sum + room.workstations.length, 0);
  return { shell, interior: lights + furniture, agents: seats * 5 };
}

const site = drawCallCount(buildSite(building));
const roof = drawCallCount(buildRoof(building));
const fins = drawCallCount(buildFacadeFins(building));

const exterior = building.floors.reduce(
  (sum, floor) => sum + floorCost(building, floor, { facade: true, interior: false }).shell,
  0,
);
const overview = exterior;
const cutaway = building.floors.reduce((sum, floor) => {
  const cost = floorCost(building, floor, { facade: true, hideNorth: true, interior: true });
  return sum + cost.shell + cost.interior + cost.agents + 3; // 3 point lights per floor
}, 0);
const isolated = (() => {
  const floor = building.floors[3]!;
  const cost = floorCost(building, floor, { facade: false, interior: true });
  return cost.shell + cost.interior + cost.agents + 3;
})();

const rows: Array<[string, number]> = [
  ['Exterior view', exterior + site + roof + fins + 1],
  ['Building overview (closed)', overview + site + roof + 1],
  ['Cutaway overview (interiors)', cutaway + site],
  ['Isolated floor (Technology)', isolated + site],
];

console.log('NEXORA OFFICE 3D — static scene budget (draw-call submissions)\n');
for (const floor of building.floors) {
  const cost = floorCost(building, floor, { facade: true, interior: true });
  console.log(
    `  ${floor.name.padEnd(26)} shell ${String(cost.shell).padStart(4)} · interior ${String(cost.interior).padStart(4)} · agents ${String(cost.agents).padStart(4)}`,
  );
}
console.log('');
for (const [label, count] of rows) {
  console.log(`  ${label.padEnd(32)} ~${count}`);
}

const furniture = building.floors.reduce(
  (sum, floor) => sum + floor.rooms.reduce((n, room) => n + room.furniture.length, 0),
  0,
);
const seats = building.floors.reduce((sum, floor) => sum + floor.rooms.reduce((n, room) => n + room.workstations.length, 0), 0);
console.log(`\n  Rooms: ${building.floors.reduce((n, floor) => n + floor.rooms.length, 0)} · furniture items: ${furniture} · seats: ${seats}`);
console.log('  Repeated mullions, columns, fins and frames are instanced; interiors use a');
console.log('  level-of-detail switch so the closed overview does not pay for furniture.\n');
