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
| `scene/character/appearance.ts` | Deterministic per-agent look: height, build, skin, hair, clothing, glasses, phase |
| `scene/character/parts.ts` | Part catalogue (data) for body and chair, in two LOD tiers |
| `scene/character/pose.ts` | Pure pose engine + forward kinematics + grounding |
| `scene/character/behaviour.ts` | Status → posture mapping, micro-activity schedule, locomotion integrator |
| `scene/character/AgentCharacter.tsx` | Joint hierarchy renderer + task chair |
| `scene/character/characterSystem.tsx` | Rig registry and the single frame loop (`CharacterAnimator`) |
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

## 10. Characters

### Rig

A colleague is a hierarchy of groups — `hips → spine → chest → {neck → head, shoulder → elbow → wrist}`, and
`hips → hip → knee → ankle` — carrying shared primitive meshes. There is no skinning: the parts are rigid pieces
attached to joints, which keeps the draw cost predictable and the pose maths testable. Proportions are derived from a
single standing height:

| Segment | Fraction of height |
| --- | --- |
| hip joint height | 0.530 |
| thigh / shin / ankle | 0.245 / 0.246 / 0.039 |
| hip → chest | 0.230 |
| shoulder height | 0.810 |
| skull base → crown | 0.130 |

The three leg segments sum exactly to the hip height, so a straight leg stands on the floor with no correction.

### Pose engine

`buildPose` composes a seated pose and a standing pose, adds activity detail, blends them by `seatedMix`, layers the
walk cycle, and finally **grounds** the result: `solveSkeleton` resolves world-space joint positions, and the hip height
is offset so the lower sole is exactly on the floor. Grounding is what makes a walk cycle work without root motion —
the support foot stays planted while the swing foot clears by ~5 cm.

Seated hands are tuned against the furniture: elbows are just below the desk top (0.74 m) and the forearms are
horizontal, putting the wrists at 0.73–0.79 m depending on the occupant's height.

### Behaviour mapping

Business state and posture are separate:

| Agent status | Posture | Activity |
| --- | --- | --- |
| `WORKING` | seated | `TYPING` / `USING_MOUSE` / `READING_SCREEN` / `THINKING` (7 s deterministic blocks) |
| `IDLE` | seated | `IDLE_SEATED` (breathing, weight shift, slow glances) |
| `WAITING` | stands beside the desk | `WAITING` (weight on one leg, hands clasped, looks to the door) |
| `ERROR` | stands beside the desk | `ERROR_REVIEW` (folded arms, slow head shake) |
| `OFFLINE` | not drawn | empty chair |

The step aside is a real walk: `stepMotion` integrates the distance from the chair at 0.85 m/s, ramps the walk cycle
in over the first 16 cm, blends sit/stand over 18 cm, and never overshoots. `CharacterAnimator` reads the real frame
delta (clamped at 100 ms) and drives every registered rig from one `useFrame`.

### Determinism and variety

`hashString(agentId)` (FNV-1a) seeds a mulberry32 stream that picks height, build, skin, hair, clothing, glasses and the
animation phase. Colour choices come from a bounded office palette (6 skin tones, 6 hair colours, 7 tops, 4 trousers,
3 shoes), so the crowd reads as one company. Materials are cached by role + colour, keeping a 27-person workforce at
roughly 25 GPU materials.

### Cost

`npm run stats` reports both tiers: 60 meshes per full-detail character (chair included) and 21 in the compact tier.
Full detail is used inside a floor or room view; the cutaway overview — where all 27 people share the frame — uses the
compact rig. The next optimisation target is merging each room's furniture by material, which dominates the cutaway
budget.

## 11. Agent movement and autonomous activities

Movement and behaviour live in four pure modules plus one thin renderer, so the whole model is testable without a
canvas:

| Module | Responsibility |
| --- | --- |
| `scene/character/navigation.ts` | 0.2 m occupancy grid per floor (walls, door gaps, furniture, 0.26 m body radius), A\* routing, line-of-sight smoothing, corridor lanes, lift anchor, reachability queries |
| `scene/character/journey.ts` | One-floor or two-leg (lift) journeys, the walker integrator, lift phases, local avoidance |
| `scene/character/activity.ts` | Per-agent finite state machine: role family, activity vocabulary, task/status transitions, meeting seats and allocation |
| `scene/character/activitySystem.ts` | The single scheduler: publishes operational context, steps every machine, reports arrivals |
| `scene/character/AgentCharacter.tsx` | The rig: walks to the activity destination, blends poses, reports arrival |

### Navigation

The grid is carved per floor from `building` geometry: room interiors inside the interior-wall inset, a gap of
`door.width` at each door, the corridor band, and nothing within `AGENT_RADIUS + WALL_CLEARANCE` of a furniture
footprint (`desk`, `meeting-table`, `server-rack`, … are solid; `chair`, `rug`, `stool`, `plant` are not). Grids are
cached per floor id and cleared by `clearNavCache()`.

`planRoute` snaps both endpoints to the nearest walkable cell (8-cell search ring), then:

1. A\* with an octile heuristic over the 8 neighbourhood, refusing diagonal moves that squeeze past a corner.
2. If either endpoint is inside a room and they are different rooms, the trip is stitched from three sub-routes:
   room → corridor lane, lane → lane, lane → room. The lane is `±0.55 m` from the corridor centre line, chosen by
   travel direction (right-hand traffic), so opposing walks do not share a line.
3. A line-of-sight pass removes redundant waypoints, which keeps turns smooth.
4. If the exact destination is unreachable but the space around it is walkable, the route ends at the closest reachable
   cell and is flagged `adjusted` with a note; genuinely off-grid destinations fail with `UNREACHABLE` / `OUT_OF_BOUNDS`.

Measured on the shipped building: 20 ms to build all five grids, ≈ 9 500 walkable cells out of 16 200 per floor,
2.1 ms per routed trip, 65/65 workstation anchors routable from the lift with no adjustment needed, and no walkable
cell on any floor disconnected from the lift (a test asserts this).

### Journeys and walking

`planJourney` returns one leg for a same-floor trip and two legs plus a lift ride otherwise
(`WALKING → WAITING_LIFT → RIDING_LIFT → WALKING → ARRIVED`). The walker is hidden while the doors are closed and its
elevation follows the floor it is on, so a trip from floor 1 to floor 3 crosses 8.4 m of height with no visual glitch.
Speed is 1.05 m/s; `advanceWalker` consumes the real frame delta and never overshoots a waypoint. Facing is damped
(`1 − e^(−8·dt)`), so turns are gradual.

`avoidanceFor(id, position, heading, others)` returns a speed scale and a lateral offset. A colleague with somebody on
their line of travel within 1.2 m slows to as little as 0.05× and steps up to 0.85 m off the planned line; the
higher id yields, so the pair resolves deterministically and both keep moving. Lateral offsets the size of a corridor
lane are safe by construction because the other walker is in the opposite lane.

### Activities

`ActivityKind` is the complete vocabulary (`IDLE`, `WALKING`, `TURNING`, `SITTING_DOWN`, `SITTING`, `STANDING_UP`,
`TYPING`, `READING`, `THINKING`, `TALKING`, `MEETING`, `PICKING_UP`, `RETURNING_TO_WORK`) and each kind maps to a pose
library animation with a posture (`SEATED`, `STANDING`, `TRANSIT`). New pose states added for this stage: `TALKING`,
`MEETING` (seated) and `PICKING_UP` (standing).

Precedence inside `stepActivity` is deliberate:

1. **operational facts** — offline, blocked (`WAITING`), failed (`ERROR`) — win over everything;
2. **meetings** — a scheduled convener stands up, walks to its allocated chair, sits for the meeting and walks back;
3. **destination retargeting** — a relocation changes the destination without disturbing the activity;
4. **task churn** — assigned, finished, replaced or cancelled, each with its own stand → walk → sit sequence;
5. **desk rhythm** — a seeded 22–30 s block picks a role-coherent activity, with a `PICKING_UP` interlude every fourth
   block.

Role families (`engineering`, `design`, `analysis`, `commercial`, `management`, `support`) are derived from the role
title and each owns its activity set, so a finance analyst never "types like a designer" by accident.

### Scheduling and rendering

`AgentLayer` publishes a context per agent (agent, task, workstation, home seat) whenever operations change.
`CharacterAnimator` — a single `useFrame` for the whole workforce — first steps every activity machine, then updates
every rig. The rig compares the activity destination with its own plan, plans a journey when it changed, walks it,
reports arrival (which is what lets the machine move on from `WALKING`), and blends joints with an exponential damping
(`1 − e^(−14·dt)`) so pose changes cross-fade instead of snapping. 27 agents cost ≈ 0.06 ms per frame in the harness.

### Desk screens

Each workstation monitor carries a plane 24 mm in front of the glass, textured from a 320 × 180 canvas
(`scene/character/deskScreens.ts`). The wording comes from `screenContentFor`, a pure function over the agent, its task,
the room and the live activity — so what a screen says is testable without a canvas. Painting is throttled twice: only
when the content key changes, and at most once per 400 ms per screen, with the clock as the only part that moves while an
activity is steady. Textures are `LinearFilter` with no mipmaps and are disposed when the agent unmounts. The compact
(cutaway) tier renders no screens, which keeps the overview cheap.

### Breaks and circulation

Idle colleagues do not stay seated forever. `breakPlan` gives every agent a staggered window (a 45 s break inside a 210 s cycle, offset by its id seed), and `breakSpot` picks a real place to stand: beside the lounge coffee table when the
floor has a lounge, otherwise the corridor band by the lift core, spread over a few metres so two colleagues never share
a spot. The FSM sequence is the same as any other trip — `STANDING_UP → WALKING → IDLE` (standing) → `STANDING_UP →
WALKING → SITTING_DOWN` — and a task arriving mid-break takes precedence immediately.

### What is deliberately not here

No animation clips, no GLB assets, no skinning, no physics engine, no third-party pathfinding. Nothing is fetched at
runtime. The trade-off is visible in the look: the characters are stylised miniatures rather than scanned humans, and
the walk cycle is procedural rather than motion-captured.
