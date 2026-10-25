/**
 * Building fixture smoke check.
 *
 *   npm run validate
 *
 * Loads the JSON fixture through the exact same path the application uses,
 * compiles the spatial model and prints every validation issue.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBuilding } from '../src/domain/building';

const raw = JSON.parse(
  readFileSync(join(process.cwd(), 'src/data/building.json'), 'utf8'),
) as unknown;

try {
  const { building, validation } = loadBuilding(raw);
  const rooms = building.floors.reduce((n, floor) => n + floor.rooms.length, 0);
  const workstations = building.floors.reduce(
    (n, floor) => n + floor.rooms.reduce((m, room) => m + room.workstations.length, 0),
    0,
  );
  console.log(
    `Building "${building.name}": ${building.floors.length} floors, ${rooms} rooms, ${workstations} workstations.`,
  );
  if (validation.warnings.length) {
    console.log(`\n${validation.warnings.length} warning(s):`);
    for (const issue of validation.warnings) {
      console.log(`  [${issue.code}] ${issue.message}`);
    }
  }
  console.log('\nValidation passed (no errors).');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
