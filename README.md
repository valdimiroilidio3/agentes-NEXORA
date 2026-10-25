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
- Workstation seating is validated (exists, belongs to the room, not double-booked).
- **Miniature humans, not capsules.** Every agent is a jointed figure built from human proportions (7.7 heads, 1.62–1.86 m,
  anatomically scaled limbs): skull with jaw, nose, ears, eyes and brows, hair (six styles plus optional beard), glasses,
  shirts/blouses/knits with collars and lapels, ties, jackets, trousers or skirts, shoes, hands with thumbs and fingers,
  and an ergonomic task chair sized to the occupant's lower leg.
- Characters are driven by a pure pose engine: seated work (`TYPING`, `USING_MOUSE`, `READING_SCREEN`, `THINKING`),
  seated idle, standing idle, `WAITING` and `ERROR_REVIEW` with folded arms, plus a walking cycle. Forward kinematics
  grounds the lowest sole on the floor in every frame, so nobody floats or sinks.
- Posture follows operations: working and idle agents sit at their desks; agents blocked on a dependency or reviewing a
  failure stand up, step beside the chair, and sit back down when work resumes. Offline agents leave an empty chair.
- Appearance is deterministic per agent id, and idle/working phases are desynchronised, so the workforce never breathes
  or types in lockstep. One shared frame callback updates every rig.
- Room-level activity strips communicate state without adding permanent labels.
- Agent status is derived from the task it holds. Operator controls are limited to taking an agent offline / bringing it
  online and clearing an error. Moving an agent is an explicit, validated operation that updates the spatial assignment
  and the rendered position at the same time.

### Agent navigation and movement

- Agents are no longer placed at coordinates: they **walk**. `src/scene/character/navigation.ts` builds a cached
  0.2 m occupancy grid per floor from the real walls, doors and furniture, inflated by the 0.26 m body radius. Routes are
  A\* over that grid and then smoothed with a line-of-sight pass, so a path leaves a room through its actual door, walks
  the corridor and enters through a second door instead of cutting a diagonal through a desk.
- Right-hand traffic is planned, not improvised: colleagues heading east walk the south lane and colleagues heading west
  walk the north lane, so opposing trips are already separated before anybody moves.
- `src/scene/character/journey.ts` stitches a trip between floors: room → corridor → lift → corridor → room, with the
  walker hidden while the doors are closed and its elevation following the storey it is on.
- Walking is frame-rate independent (1.05 m/s, clamped delta), facing is damped rather than snapped, and a colleague
  always stops where the seat anchor is — never on the desk, never inside the chair.
- **Avoidance**: a colleague whose path passes within arm's reach slows down; when two people genuinely cross, the one
  with the higher id yields and steps to its own right while the other keeps walking. Both keep moving (no deadlock) and
  a head-on crossing in the 3.6 m corridor keeps ≥ 0.55 m between them while both keep walking.
- **Blocked destinations** are handled honestly: an unreachable point is reported (`UNREACHABLE` / `OUT_OF_BOUNDS`) and
  the agent stays where it is with a console explanation instead of sliding through walls; if a destination is walled
  off but the surrounding space is walkable, the route ends at the closest reachable point and the journey is flagged.
- `npm run stats`-level guarantees are covered by tests: every one of the 65 workstation anchors and every room is
  routable, and every walkable cell on every floor is reachable from the lift (no isolated pockets).

### Autonomous activities

- Each agent runs a finite state machine (`src/scene/character/activity.ts`) with the full animation vocabulary:
  `IDLE`, `WALKING`, `TURNING`, `SITTING_DOWN`, `SITTING`, `STANDING_UP`, `TYPING`, `READING`, `THINKING`, `TALKING`,
  `MEETING`, `PICKING_UP`, `RETURNING_TO_WORK`.
- Activities are **role-coherent and operational**: engineers type, analysts read, commercial roles talk, management
  convenes. Desk activity is chosen from the role's own set on a seeded rhythm (22–30 s, different per colleague), with
  an occasional reach for something on the floor. Nothing is invented about the work itself: every activity carries the
  task title and the operational reason that caused it, and no result is fabricated.
- Transitions follow the real task system: a task arriving makes the colleague sit down before working; a task that
  finishes makes them stand, walk it off and sit back down; a task changed or cancelled mid-work is recorded in the
  agent's activity history and the destination is re-planned.
- Meetings are real: management roles convene on their own floor, seats are allocated deterministically from the chairs
  actually placed around the meeting table (no two colleagues on one chair, everyone oriented toward the table), and the
  agent walks there, sits, stays for the meeting and walks back.
- **Idle colleagues get up.** Every few minutes (staggered per agent, 45 s out of a 210 s cycle), an idle colleague stands, walks to the lounge (or
  the corridor by the lift on floors without one), stands there for 45 s and walks back to the chair. A task
  that arrives mid-break wins immediately.
- One scheduler (`src/scene/character/activitySystem.ts`) advances all 27 machines per frame (~0.06 ms per frame in the
  test harness), then the single rig callback poses the bodies: no per-agent render loop, no React re-render during
  animation.

### Live desk screens

- Every workstation monitor is a **live display**, not a dark plane. It shows, in the 3D scene: the occupant's name and
  role, operational status, the current activity and its reason, the task title and status, the room and a running wall
  clock. Reading a screen is the same as looking over a colleague's shoulder.
- Content is composed by one pure function (`screenContentFor`) and painted onto a per-monitor canvas texture by a
  registry that repaints only when the wording changes (throttled to 0.4 s per screen). No React re-render is involved
  and each monitor costs one extra plane and one texture in the full-detail tier; the compact cutaway tier skips screens.
- Screens are honest: an offline colleague's monitor says the agent is offline, a blocked one says it is waiting, and a
  failed one shows the failure reason instead of inventing progress.
- Desks are dressed as workplaces: keyboard, mouse, mug and papers are modelled on every desk, so a workstation reads as
  occupied furniture rather than a bare slab.

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
  scene/             # R3F scene: procedural architecture, furniture, camera rig,
                     # visibility rules, materials
  scene/character/   # miniature humans: appearance, part catalogue, pose engine
                     # with forward kinematics, behaviour mapping, shared animator
  ui/                # top bar, panels, inspector, status bar, chrome
  app/               # Next.js App Router entry + /api/executions bridge
tests/               # 137 unit, geometry, character, scene-graph and store tests
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
| `npm test` | 198 passed / 198 across 14 files |
| `npm run validate` | 5 floors, 38 rooms, 65 workstations, no warnings |
| `GET /api/executions` | `200` `{mode:"unavailable"}` |
| `POST /api/executions` (unconfigured) | `501 INTEGRATION_UNAVAILABLE` |
| `POST /api/executions` (invalid body) | `400 INVALID_REQUEST` |
| Scene graph (headless R3F render) | All 5 floors, cutaway, floor isolation and click navigation render without errors |
| Agent routing | 65/65 workstation anchors routable; cross-room routes leave and enter through doors; every walkable cell is reachable from the lift on all 5 floors |
| Agent walking (headless R3F) | A relocated colleague walks desk→desk in ≤ 0.12 m per frame (no teleport), covers the true path length, and stops within 0.4 m of the target seat |
| Crossing without collision | Two colleagues walking opposite ways through the corridor keep ≥ 0.55 m separation and both arrive |
| Activity FSM | 13 animation states, role-coherent sets, task start/finish/change transitions, meeting seat allocation and return, deterministic and staggered |
| Scheduler cost | 27 agents × 1 800 frames in 101 ms (≈ 0.06 ms/frame) in the test harness |
| Desk screens | one live screen per colleague, painted with the activity wording; screens unmount and release their textures with the agent |
| Office life | idle colleagues leave for a staggered break, stand on their own spot, and return; a running task cancels the break |
| Navigation grids | 20 ms to build all five floors; ≈ 9 500 walkable cells of 16 200 per floor; 2.1 ms per route |
| Characters (headless) | 27 rigs registered and released, a WAITING agent walks 0.45–1.1 m from its chair, a WORKING agent stays seated (tests) |
| Feet/hands alignment (FK) | Lower sole ≤ 1 mm from the floor in every state/seed/frame; seated wrists at 0.68–0.90 m (desk top 0.74 m) |
| `npm run stats` | 60 meshes per full-detail colleague, 21 compact; cutaway ≈ 2432 submissions |

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
