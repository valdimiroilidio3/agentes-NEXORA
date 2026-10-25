# Architecture

## 1. Principles

1. **One source of truth.** `Building` (spatial) and `OperationsState` (tasks, agents, events) are the only mutable
   inputs. Panels and the 3D scene are pure projections of them.
2. **Domain first, environment later.** Everything that can be reasoned about — geometry generation, validation, state
   transitions, summaries — lives in `src/domain` or in pure functions under `src/scene` and is unit tested in Node.
3. **Rendering subscribes.** The scene never writes state. Interactions dispatch store actions; the scene re-renders
   from the new state.
4. **Honesty over gloss.** A run either goes through a configured execution service or is labelled simulated. Failures
   and missing integrations are surfaced, never smoothed over.
5. **Configuration over code.** Rooms, floors, agents and tasks are data. Templates are the only place that knows how a
   *kind* of room is furnished.

## 2. Coordinate system and units

- Metres. `+x` east, `+z` south, `+y` up. "North" is `-z` and carries the main entrance.
- Room rectangles are defined by centre (`x`, `z`) plus `width`/`depth`.
- Floor elevations are `index × floorHeight` (0, 4.2, 8.4, 12.6, 16.8 m).
- Slabs are 0.3 m thick with the finished floor level on top of the slab.
- Interior partitions are 0.12 m, façade 0.6 m, corridor band 3.6 m deep, bands 6.6 m deep.

## 3. Spatial model and validation

`BuildingConfig` (JSON) → `parseBuildingConfig` (zod) → `buildBuilding` → `validateBuilding`.

The compiler adds, per room: stable `floorId`, resolved ceiling height, calculated exterior walls, and generated
furniture + workstations + seat anchors from the room template.

`validateBuilding` reports typed issues (`code`, `severity`, `message`, `floorId?`, `roomId?`) and blocks hard errors:

| Check | Code |
| --- | --- |
| Duplicate ids / codes | `room.duplicateId`, `room.duplicateCode`, `floor.duplicateId` |
| Floor index / elevation / footprint coherence | `floor.indexOrder`, `floor.elevation`, `floor.footprint` |
| Room inside plate, minimum dimension | `room.outOfBounds`, `room.dimensions` |
| Room overlapping another room or the corridor | `room.overlap`, `room.corridorOverlap` |
| Ceiling above floor clearance | `room.ceilingHeight`, `floor.ceilingHeight` |
| Door outside its wall / too narrow / not on circulation | `room.doorOutsideWall`, `room.doorWidth`, `room.doorCirculation` (warning) |
| Furniture outside a room or floating | `furniture.outOfBounds` |
| Furniture blocking a doorway clearance volume | `furniture.blocksDoor` |
| Workstation outside / duplicate / crowd / blocking a door | `workstation.*` |
| Dead zones in a floor band | `floor.bandCoverage` (warning) |

Cross-entity integrity (`validateAssignments`) then checks agents against rooms/workstations and tasks against agents,
rooms and dependencies: `agent.workstationConflict`, `agent.workstationMissing`, `agent.taskNotActive`,
`agent.workingWithoutTask`, `task.dependencyMissing`, `task.selfDependency`, and more. Errors prevent the application
from loading operational data at all (an explicit error screen lists them).

## 4. Operational model

```ts
AgentStatus = 'IDLE' | 'WORKING' | 'WAITING' | 'ERROR' | 'OFFLINE'
TaskStatus  = 'QUEUED' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED'
```

Task transitions (`domain/tasks.ts`, total and explicit):

| From | Allowed to |
| --- | --- |
| `QUEUED` | `RUNNING`, `FAILED` (cancel) |
| `RUNNING` | `COMPLETED`, `FAILED`, `WAITING` |
| `WAITING` | `RUNNING`, `FAILED` |
| `COMPLETED` | — |
| `FAILED` | `QUEUED` (retry only when `error.retryable`) |

Every operation in `domain/operations.ts` returns `{ ok: true, state, event }` or `{ ok: false, code, message }` and:

- validates preconditions (`TASK_NOT_FOUND`, `INVALID_TRANSITION`, `DEPENDENCIES_UNMET`, `AGENT_BUSY`,
  `AGENT_OFFLINE`, `TASK_UNASSIGNED`, `WORKSTATION_CONFLICT`, …);
- keeps the agent consistent with the task it holds (`WORKING`/`WAITING` with `currentTaskId`, `IDLE` after completion
  or cancellation, `ERROR` after failure);
- appends an immutable event (`TASK_STARTED`, `TASK_PROGRESS`, `TASK_COMPLETED`, `TASK_FAILED`, `TASK_RETRY_SCHEDULED`,
  `TASK_CANCELLED`, `AGENT_STATUS_CHANGED`, `AGENT_REASSIGNED`, `INTEGRATION_UNAVAILABLE`, `DATA_LOADED`), capped at
  the 300 most recent events.

Progress updates are informational only: they never change status, so a UI tick can never fake a state change.

Agent movement is `moveAgent`, which validates the target room, the workstation, vacancy and that the agent holds no
active task, then updates the assignment that the scene reads. There is no other way to move an agent.

## 5. Execution ports

```ts
interface ExecutionPort {
  mode: 'simulated' | 'live';
  label: string;
  execute(req: { task; agent; signal?; onProgress? }): Promise<ExecutionOutcome>;
}
```

- `createDemoExecutionPort()` — seeded FNV-1a hashing of `task.id` produces a deterministic duration and failure
  decision; waits are injectable, so tests run instantly. Results carry `simulated: true` and `source: 'demo-adapter'`.
- `createLiveExecutionPort()` — posts to `/api/executions`; the route validates the request with zod, adds the
  server-only bearer token, applies a 25 s timeout, validates the upstream payload and maps errors to
  `INTEGRATION_UNAVAILABLE` (501), `UPSTREAM_*` (502) or `INVALID_RESPONSE`. The browser never sees the upstream URL
  or token.

The store orchestrates: `startTask` → adapter → `progressTask`* → `completeTask` | `failTask`. If the task is no longer
`RUNNING` when the adapter resolves (cancelled or changed), the outcome is discarded with a warning instead of
corrupting state.

## 6. Scene

### Layers

| Component | Responsibility |
| --- | --- |
| `scene/architecture.ts` | Pure `BoxSpec` generation: slabs, finishes, walls with door openings, doors, columns, light fixtures, room ceilings |
| `scene/facade.ts` | Curtain walls, ribbon glazing, fins, roof, site, entrance, sign position |
| `scene/Furniture.tsx` | Catalogue of 19 furniture kinds from primitive meshes |
| `scene/AgentAvatar.tsx` | Seat, body, status ring (pulses only when working) |
| `scene/FloorScene.tsx` | `FloorShell` (memoised architecture + furniture), `FloorLiveLayer` (highlights, labels, agents, activity strips), lights |
| `scene/OfficeScene.tsx` | Canvas, environment, camera rig, HUD probe; `SceneWorld` is the pure scene graph |
| `scene/visibility.ts` | Visible floors and façade/roof/fin layers per view |
| `scene/camera.ts` | Pure pose computation per view |

### Level of detail

Interior furniture and fixtures only render when the interior is revealed (cutaway, floor or room view), because in the
closed overview they sit behind 0.24-opacity glass. This is a measured optimisation: see §8.

### Materials and lighting

- One shared material per surface type and one unit box/cylinder/sphere geometry reused by every mesh.
- Repeated identical boxes (mullions, fins, spandrels, columns, door frames) collapse into `InstancedMesh` groups of ≥5.
- Procedural `RoomEnvironment` → PMREM environment map gives glass and metal plausible reflections without any HDR
  download; ACES filmic tone mapping, sRGB output.
- One shadow-casting directional sun plus hemisphere/ambient fill; three point lights per revealed floor; emissive
  strips for artificial light. No bloom, no particles.

### Camera

`computeCameraPose` returns a pose per view:

- exterior: north-east, above the roof line, looking at 42 % of the building height;
- building: closer three-quarter view;
- floor: 15.5 m above the isolated floor, looking slightly north;
- room: offset scaled by room size (`clamp(max(width, depth) × 2.1, 9, 20)`), always above the ceiling plane.

The rig eases position and target with `easeInOutCubic` over 0.95 s and cancels immediately on any user interaction
(`OrbitControls` `start` event), so navigation is interruptible. Orbit limits: 5–~88 m distance, polar angle clamped to
just above the horizon.

## 7. State and UI

`store/officeStore.ts` (zustand) holds the compiled building, the operational state, the execution adapter selection,
view/selection state, filters, inspector tab and the current toast. Actions are the only writers. Load and validation
failures become a first-class `status: 'error'` with the reasons rendered on screen.

Panels subscribe with narrow selectors; the scene subscribes to the state slices it renders. `FloorShell` is memoised
on `(building, floor, showFacade, showInterior, hiddenFacadeSide)` so operational updates never rebuild wall geometry.

## 8. Measured scene budget

`npm run stats` produces (from the real generators, counting draw-call submissions after instancing):

| View | Submissions |
| --- | --- |
| Exterior | ~364 |
| Building overview (closed façade) | ~363 |
| Cutaway overview (all interiors revealed) | ~2214 |
| Isolated floor (Technology) | ~479 |

Interior cost is dominated by furniture (340 items, ≈1525 primitive meshes) and 65 avatars (≈325 meshes). Frame rate
was **not** measured — there is no GPU in the development environment — so no FPS claim is made. The next optimisation
is merging each room's furniture into per-material geometry (target: cutaway below ~700 submissions).

## 9. Accessibility

- Full navigation through the floor and room lists, with `aria-pressed` state, without touching the canvas.
- Search with keyboard navigation and `role="listbox"`/`role="option"` semantics.
- Visible focus rings, labelled icon buttons, `aria-live` toasts, `role="alert"` error states.
- `prefers-reduced-motion` disables animations.
- Status is never conveyed by colour alone: dots are paired with text badges (`WORKING`, `FAILED`, `SIMULATED`).

## 10. Extension points

- New room kinds: add a template function in `domain/templates.ts` and a `RoomTemplateId`.
- New execution backends: implement `ExecutionPort` (an HTTP worker, a queue consumer, an LLM provider) and register it
  in the store; nothing in the scene or reducer changes.
- Persistence: the reducer emits a complete event log, so writing tasks/events to Postgres/Supabase is an adapter
  concern; server-side authorisation must be added before multi-user use.
