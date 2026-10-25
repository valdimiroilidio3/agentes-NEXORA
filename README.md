# NEXORA OFFICE 3D

An interactive 3D corporate headquarters: five storeys, 38 individually selectable rooms, 65 workstations, 27 AI-agent
seats and an operational task engine whose state drives what the building shows.

The 3D building is the primary interface — exterior, cutaway, isolated floors and room-level inspection — with a
professional management layer around it. Every agent, task and result in this repository is **demo data**, and every
execution is performed by a clearly labelled **simulated adapter** unless a live execution bridge is configured.

```
EXTERIOR → BUILDING OVERVIEW (cutaway) → FLOOR → ROOM → AGENT / TASK
```

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Requires Node.js ≥ 20.9. WebGL 2 is needed for the 3D viewport; if the context cannot be created the application
still runs and the floor/room navigation, task board and inspector remain fully usable.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server on `0.0.0.0:3000` |
| `npm run build` | Production build (verified: passes) |
| `npm start` | Serve the production build |
| `npm run typecheck` | Strict TypeScript check (`tsc --noEmit`) |
| `npm test` | Vitest suite (112 tests across 8 files) |
| `npm run validate` | Compiles the building fixture through the real load path and prints spatial issues |
| `npm run stats` | Static scene-budget report (draw-call submissions per view) |

---

## What is implemented

### Architecture (procedural, no external assets)

- 36 m × 18 m floor plates, 4.2 m floor-to-floor, 3.6 m central corridor, 5 stacked floors with a consistently
  positioned vertical core (two lifts, two-flight stair, lift lobby).
- Curtain walls with bay-by-bay vision glass, mullions, transoms and spandrels; ribbon glazing on the short ends;
  vertical concrete fins; roof with parapet, plant and photovoltaic array; plaza, planting, entrance canopy and an
  illuminated sign.
- 11 room templates (reception, operations centre, open workspace, private/executive office, meeting room, creative
  studio, laboratory, lounge, core, security) generating furniture, workstations and seat anchors from configuration.
- Interior walls are generated per floor with shared edges de-duplicated and door openings cut out; glass partitions
  are used for the corridor wall of meeting rooms, offices, labs and studios. Doors have frames and opened leaves.
- 38 rooms, 340 furniture items, 65 workstations. Rooms are not copies: each template has its own furniture logic and
  dimensions drive placement (e.g. desk counts scale with room width; three-column layouts appear above 13.5 m).

### Navigation

- Exterior, cutaway, whole-building, isolated-floor and room views with smooth, interruptible camera interpolation.
- Independent per-floor visibility toggles, floor isolation, cutaway (removes the camera-facing façade and roof),
  reset view, and a breadcrumb path `Building / Floor / Room / Agent`.
- Room selection by pointer with a drag guard, hover pre-highlight, and a keyboard-accessible alternative: floor list →
  room list in the left panel. Search (`⌘K`, `/`) across rooms, floors, agents, departments and tasks jumps directly to
  the right floor and camera.
- Keyboard: `0` building, `E` exterior, `1–5` floors, `C` cutaway, `R` reset, `Esc` clear, `?` shortcuts.

### Agents

- Strongly typed agent model with stable IDs, role, specialisation, department, room, workstation, status
  (`IDLE | WORKING | WAITING | ERROR | OFFLINE`), current task, last activity and optional execution metadata.
- Workstation seating is validated (exists, belongs to the room, not double-booked). Agents are rendered as stylised
  avatars with a restrained status ring; only `WORKING` agents pulse. Room-level activity strips communicate state
  without adding permanent labels.
- Agent status is derived from the task it holds. Operator controls are limited to taking an agent offline / bringing it
  online and clearing an error. Moving an agent is an explicit, validated operation that updates the spatial assignment
  and the rendered position at the same time.

### Tasks and execution

- Explicit state machine: `QUEUED → RUNNING → COMPLETED`, `RUNNING → WAITING → RUNNING`, `RUNNING|WAITING|QUEUED →
  FAILED`, and `FAILED → QUEUED` for retries. Every other transition is rejected with a typed error.
- Dependencies are enforced before a run can start. Duplicate execution, cancellation, retryability and task/agent
  consistency are all checked in the reducer, not in the UI.
- Execution sits behind an `ExecutionPort` interface:
  - **Demo adapter** (default): deterministic, seeded, explicitly `simulated: true`, source `demo-adapter`, labelled
    “Demo adapter (simulated)” in the status bar. It contacts nothing.
  - **Live bridge**: posts to this app's `/api/executions` route, which holds the upstream URL and token server-side.
    With no `NEXORA_EXECUTION_ENDPOINT` configured it returns `501 INTEGRATION_UNAVAILABLE`; the UI reports the failure
    and never fabricates success.
- Task board with status filters, text filter, department filter, agent/room filters, run/stop/retry actions, re-assign,
  and per-task execution history. Results show metrics, artefacts and a `SIMULATED RESULT` badge.

### Interface

- Dark architectural UI: branded top bar with breadcrumbs and search, compact left rail with floor/room navigation,
  right inspector (`Context | Tasks | History`), viewport chrome, expandable company-wide overview, status bar with
  counts, spatial-validation warnings, data-source badge and execution adapter.
- Loading, empty, error, selected, disabled and success states are implemented. Panels are keyboard navigable and the
  building is fully traversable without the 3D canvas.

---

## Architecture

```
src/
  domain/            # environment-agnostic model + rules (no React, no Three.js)
    types.ts         # spatial + operational types
    schema.ts        # zod validation of every JSON fixture
    space.ts         # rect maths, doors, clearance, spatial validation
    templates.ts     # room templates → furniture + workstations
    building.ts      # config → compiled building (with generated furniture)
    agents.ts        # assignment integrity, derived status
    tasks.ts         # task state machine + dependency rules
    operations.ts    # pure reducer: tasks, agents, event log
    selectors.ts     # derived summaries, filtering, search
  data/              # building.json, agents.json, tasks.json (demo fixtures)
  services/execution # demo adapter + live bridge adapter
  store/officeStore.ts # zustand: load, navigation, execution orchestration
  scene/             # R3F scene: procedural architecture, furniture, avatars,
                     # camera rig, visibility rules, materials
  ui/                # top bar, panels, inspector, status bar, chrome
  app/               # Next.js App Router entry + /api/executions bridge
tests/               # 112 unit, geometry, scene-graph and store tests
scripts/             # fixture validation + scene budget report
docs/                # architecture, provenance/licensing, implementation report
```

**Single source of truth.** Fixtures → validated config → compiled `Building` + `OperationState`. The scene and the
panels both subscribe to the same store; no UI handler mutates 3D objects and no renderer mutates domain state.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the schemas, invariants, transitions and rendering decisions.

---

## Configuration

Floors and rooms live in `src/data/building.json`. Adding a room is a configuration change:

```jsonc
{
  "id": "f1-lab-2",
  "name": "Prototype Lab",
  "code": "1-09",
  "template": "lab",          // drives furniture + workstations
  "purpose": "integration",
  "rect": { "x": 4, "z": 5.1, "width": 7, "depth": 6.6 },
  "door": { "edge": "north", "offset": 0, "width": 1.2 }
}
```

`npm run validate` must report no errors before shipping the change; the application refuses to render a building whose
configuration fails validation and shows the reasons instead.

Workstation IDs follow `{roomId}-ws{n}`, which is what `agents.json` references.

### Environment

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXORA_EXECUTION_ENDPOINT` | server only | Upstream execution service for the live bridge |
| `NEXORA_EXECUTION_TOKEN` | server only | Bearer token for that service (never sent to the browser) |

Copy `.env.example` to `.env.local` to configure the bridge. Without it, live mode fails honestly with
`INTEGRATION_UNAVAILABLE`.

---

## Deployment

- **Vercel**: import the repository, framework preset Next.js, build `npm run build`. No environment variables are
  required for the demo mode. Add the two server-side variables only when a real execution backend exists.
- Any Node host: `npm ci && npm run build && npm start` (binds `0.0.0.0:3000`).
- The 3D viewport is client-only (`ssr: false`); the API route is dynamic and never cached.

---

## Verified status

| Check | Result |
| --- | --- |
| `tsc --noEmit` | Passes |
| `next build` | Passes (static `/` + dynamic `/api/executions`) |
| `npm test` | 112 passed / 112 across 8 files |
| `npm run validate` | 5 floors, 38 rooms, 65 workstations, no warnings |
| `GET /api/executions` | `200` `{mode:"unavailable"}` |
| `POST /api/executions` (unconfigured) | `501 INTEGRATION_UNAVAILABLE` |
| `POST /api/executions` (invalid body) | `400 INVALID_REQUEST` |
| Scene graph (headless R3F render) | All 5 floors, cutaway, floor isolation and click navigation render without errors |

**Not verified:** frame rate on real GPU hardware, and visual review in a browser with a real WebGL context (no browser
is available in the implementation environment). Interactive previews were exercised through the headless scene-graph
tests and the running dev server's HTTP responses. See [docs/REPORT.md](docs/REPORT.md) for the honest list of
limitations and the next priorities.

---

## Licensing and asset provenance

All geometry, materials, interface, fixtures and copy in this repository are original work created for this project.
There are no downloaded textures, models, fonts or icon sets: everything is generated at runtime from code and system
fonts. Dependencies are permissively licensed (MIT/ISC). The Agents Office project that inspired the concept was used
for conceptual orientation only; no source code, assets or implementation details were copied.

Full details: [docs/ASSET-PROVENANCE.md](docs/ASSET-PROVENANCE.md).

## License

MIT — see [LICENSE](LICENSE).
