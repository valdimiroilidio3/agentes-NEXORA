# Implementation report

## 1. Initial audit

| Item | Finding |
| --- | --- |
| Repository | `valdimiroilidio3/agentes-NEXORA`, branch `arena/c2a8c136-agentes-nexora`, one commit (`2dca7a7 Initial commit`) |
| Files | `README.md` containing only `# agentes-NEXORA` |
| Framework | None. No `package.json`, no source, no tests, no deployment config |
| Licensing | No licence file. The brief states the Agents Office reference project has restricting licensing, so no code or assets were taken from it |
| Risk | A greenfield build was required; the only realistic failure mode was inventing features that could not be verified |
| Tooling available | Node 22.22, npm 10.9, npm registry reachable, no browser/GPU in the environment |

Consequence: every architectural decision below had to be made explicitly and validated with tests, because visual
review in a real browser was not possible here.

## 2. Architecture decisions

1. **Next.js 15 + React 19 + R3F 9 + three 0.186.** Matches the brief, keeps the 3D bundle behind a client boundary,
   and gives a server route for the execution bridge.
2. **Pure domain core, thin presentation.** Spatial generation, validation, state machines and summaries are pure
   TypeScript and tested in Node. React and three never appear in `src/domain`.
3. **Box-spec geometry compiler.** `architecture.ts`/`facade.ts` emit `BoxSpec` arrays; the React layer is a dumb
   renderer. This made it possible to unit test walls, door openings, cutaway layers and camera framing without WebGL.
4. **Room templates.** A template receives a room and returns furniture + workstations + capacity, so adding a room is a
   JSON change and adding a *kind* of room is one function.
5. **Operational state as a reducer with an event log.** Every action returns a result object, validates preconditions,
   keeps the agent synchronised with its task, and appends an audit event.
6. **`ExecutionPort` boundary.** Demo adapter (simulated, deterministic) and live HTTP bridge are interchangeable;
   the UI never claims work that did not happen.
7. **Zustand store as the single connect point.** Panels and scene subscribe; nothing writes 3D objects directly.
8. **Procedural assets only.** No HDRIs, textures or models; a PMREM environment generated from three's procedural
   `RoomEnvironment` gives physically plausible reflections at zero asset cost.
9. **Measured performance work.** Shared geometry/materials, instancing for repeated façade elements, and an interior
   level-of-detail rule derived from the measured draw-call budget.

## 3. Files created

```
package.json  tsconfig.json  next.config.ts  vitest.config.ts  .gitignore  .env.example  LICENSE  README.md
src/app/{layout.tsx,page.tsx,globals.css}
src/app/api/executions/route.ts
src/domain/{types,schema,space,templates,building,agents,tasks,operations,selectors}.ts
src/data/{building,agents,tasks}.json
src/services/execution/{demo,live}.ts
src/store/officeStore.ts
src/lib/time.ts
src/scene/{materials,architecture,facade,camera,visibility,SceneBoxes,Furniture,Labels,FloorScene,OfficeScene}.tsx|ts
src/scene/character/{appearance,parts,pose,behaviour,characterMaterials}.ts + {AgentCharacter,characterSystem}.tsx
src/ui/{AppShell,TopBar,LeftPanel,Inspector,StatusBar,Toast,ViewportChrome,primitives}.tsx
tests/{space,tasks,operations,architecture,execution,selectors,store,scene}.test.ts(x) + tests/support.ts
scripts/{validate-building,scene-stats}.ts
docs/{ARCHITECTURE,ASSET-PROVENANCE,REPORT}.md
```

## 4. Features and how to test them

| Feature | How to verify |
| --- | --- |
| Building with 5 floors, 38 rooms, 65 seats | `npm run validate`; open the app |
| Floor isolation / visibility / cutaway | Left panel floors, eye toggles, `1–5`, `C`, “Cutaway” in the toolbar |
| Room selection and camera framing | Click a room in the viewport or in the room list; `Frame` in the inspector |
| Breadcrumbs and return path | Top bar path, `Floor` button, `Esc`, `R` |
| Search across rooms/agents/tasks/departments | `⌘K`, type “board”, “atlas”, “cluster” |
| Agent detail and status | Click an avatar or an agent in a room inspector |
| Task board, filtering, re-assignment | Inspector → Tasks; chips + text + department filters |
| Running a task (simulated) | Inspector → Tasks → `Run`; watch the avatar pulse, the room strip, events and result badge |
| Failure path | Run repeatedly (seeded 18 % failure) or switch to Live bridge and run — both end in a labelled failure |
| Retry / cancel | `Retry` on a failed task, `Stop` on a running one |
| Honest integration failure | Status bar → Execution → “Live bridge”, then run any task |
| Data integrity failure screen | Break a room in `building.json` (e.g. move it outside the plate) and run `npm run validate` / reload |

## 5. Commands executed and results

```
$ npx tsc --noEmit
(no output — passes)

$ npx tsx scripts/validate-building.ts
Building "NEXORA Headquarters": 5 floors, 38 rooms, 65 workstations.
Validation passed (no errors).

$ npx vitest run
Test Files  9 passed (9)
     Tests  137 passed (137)
  Duration  ~6 s

$ npx next build
✓ Compiled successfully
Route (app)                    Size  First Load JS
┌ ○ /                       54.5 kB         157 kB
├ ○ /_not-found               994 B         104 kB
└ ƒ /api/executions           123 B         103 kB

$ npx tsx scripts/scene-stats.ts
Exterior view                    ~364 draw-call submissions
Building overview (closed)       ~363
Cutaway overview (interiors)     ~2432
Isolated floor (Technology)      ~802
One colleague                    60 meshes at full detail · 21 at compact detail

$ curl -s localhost:3000/api/executions
{"mode":"unavailable","label":"No execution service configured", ...}          HTTP 200

$ curl -X POST -d '{"taskId":"t1","agentId":"a1","title":"Demo"}' localhost:3000/api/executions
{"code":"INTEGRATION_UNAVAILABLE", ...}                                          HTTP 501

$ curl -X POST -d '{}' localhost:3000/api/executions
{"code":"INVALID_REQUEST", ...}                                                  HTTP 400
```

Test coverage by file: space 12, tasks 7, operations 26, architecture 22, execution 9, selectors 10, store 11,
scene 19 (R3F scene graph: five floors, cutaway, isolation, click navigation, live state updates, character rigs and
walking), character 21 (appearance determinism, anatomy, ground contact, desk alignment, typing cadence, idle
restraint, behaviour mapping, locomotion).

## 6. Build and deployment status

- Production build passes locally (`next build`, 6.0 s compile). `next start` was served on `:3100` and returned
  `/` with `200` (11,705-byte document), including the hashed stylesheet `<link>` and all expected markers, plus the
  same API contract (GET 200, unconfigured POST 501, invalid POST 400).
- Development server (`next dev --turbopack`) serves `/` with `200` (23,593-byte document). Dev HTML has no stylesheet
  `<link>` because Turbopack injects styles at runtime; the production document does contain it, so styling is wired
  correctly even though it could not be reviewed visually.
- Deployment was **not** performed: the session has git/GitHub access but no Vercel credentials, and the brief forbids
  inventing deployment. The project is Vercel-ready (framework preset Next.js, no required env vars for demo mode).
- `.env.example` documents the two server-side variables needed for live execution.

## 7. Known limitations and risks

1. **No real-browser verification.** The environment has no browser or GPU. The scene was validated through headless
   R3F rendering (component tree, props, click handlers, visibility rules) and the generators through unit tests. The
   production HTML ships its CSS and all shell markers, but visual composition (lighting balance, material contrast,
   label legibility at distance) and camera feel have not been reviewed in a real viewport. Treat the first browser pass
   as a design review, not a formality.
2. **Frame rate not measured.** Draw-call submissions were measured statically (see §5); no FPS figures are claimed.
   Cutaway (~2.2k submissions) is the heaviest view and the first optimisation target (merge room furniture geometry).
3. **Demo data only.** 27 agents and 15 tasks are fixtures. Nothing polls or streams; there is no persistence,
   authentication or multi-user support. The event log is in-memory and capped at 300 entries.
4. **Live bridge is unconfigured.** The client/route contract is implemented and tested with mocks, but no upstream
   service exists here, so a real end-to-end live run is unproven.
5. **No authorisation.** `/api/executions` has request validation and server-only secrets, but no authn/authz. It must
   not be deployed in live mode without authentication in front of it.
6. **Screen-reader experience of 3D.** The canvas is decorative for assistive technology; all information and
   navigation is duplicated in DOM panels, but a fully equivalent non-visual experience of the spatial model is not
   provided beyond floor/room lists.
7. **Agent animation** is limited to a pulsing ring for working agents. Walking paths, meeting-room presence and
   task-driven movement are intentionally out of scope until the assignment model supports booked rooms.
8. **Templates are fixed in code.** New furniture kinds require a renderer function; the template system is data-driven
   per room but not yet plug-in driven.

## 8. Next implementation phase

1. **Design-review pass in a real browser** at 1440 px and 1024 px: lighting exposure, glass opacity, label overlap,
   furniture density; capture screenshots and adjust.
2. **Furniture geometry merging** (per room, per material) to bring the cutaway view under ~700 submissions; then
   profile with the Chrome performance panel on real hardware and record actual FPS.
3. **Persistence adapter** (SQLite/Postgres/Supabase) for tasks and the event log behind the existing reducer contract,
   with server-side authorisation and RLS.
4. **Live execution provider** (queue worker or LLM agent runner) implementing `ExecutionPort`, plus streaming progress
   via SSE from `/api/executions`.
5. **Deeper agent choreography**: explicit room bookings, meeting attendance and movement paths driven by task context.
6. **Spatial import/export**: allow designing floors in a JSON editor with live validation feedback and a diff against
   the current graph.

## 9. Running locally

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # 112 tests
npm run validate # spatial fixture check
npm run build    # production build
```

Controls: drag to orbit, scroll to zoom, click a room or avatar. Keyboard: `0` overview, `E` exterior, `1–5` floors,
`C` cutaway, `R` reset, `⌘K`/`/` search, `Esc` clear, `?` shortcuts.

## 10. Improvement stage 1 — human agents (this iteration)

### What was audited

The previous scene drew each agent as a low cylinder (torso), a sphere (head) and a status ring, plus a two-box chair.
It was readable at a distance but wrong on three counts the brief is explicit about:

1. Not human: no neck, shoulders, elbows, wrists, hands, hips, knees or feet, and no clothing beyond a coloured mass.
2. Not anchored: the "chair" was part of the avatar, so a standing or absent agent still had a chair drawn under it.
3. Not animated: the only motion was a pulsing ring. Nothing communicated typing, reading, waiting or reviewing.

### What was built

| Module | Responsibility |
| --- | --- |
| `character/appearance.ts` | Deterministic look per agent id: height 1.62–1.86 m, build, skin, hair style/colour, top, jacket, trousers or skirt, shoes, glasses, beard, animation phase and tempo |
| `character/parts.ts` | Data catalogue of ~45 body parts and 16 chair parts in two LOD tiers; the renderer and the budget read the same list |
| `character/pose.ts` | Pure pose engine (seated work, seated idle, standing idle, waiting, error review, walking, sit/stand blend) plus forward kinematics and floor grounding |
| `character/behaviour.ts` | Agent/task status → posture and activity; deterministic 7 s micro-activity schedule; walk/sit integrator; away-point geometry |
| `character/characterMaterials.ts` | Role + colour material cache (bounded set shared by the whole workforce) |
| `character/AgentCharacter.tsx` | Joint hierarchy renderer and the ergonomic task chair |
| `character/characterSystem.tsx` | Rig registry plus the single `useFrame` that animates all characters |

Integration: `FloorAgents` renders the occupants of a floor once (not nested per room), so a character can leave the
chair without being re-parented; `SceneWorld` mounts `CharacterAnimator` and selects the detail tier
(`full` inside a floor/room view, `compact` in the cutaway overview). `AgentAvatar.tsx` was removed.

### Verified for this stage

| Property | How it is verified | Result |
| --- | --- | --- |
| No floating or sunken feet | FK sole height for 8 agents × 5 seated states × 3 standing states × 3 blends × 6 timestamps | lower sole within 1 mm of the floor |
| Hands on the desk, not through it | FK wrist position while typing, 10 agents | 0.68–0.90 m (desk 0.74 m), 0.30–0.55 m forward |
| Standing height is respected | FK crown height vs seeded height | within 1 cm |
| Typing uses both hands out of phase | 180 samples of wrist rotation | >90 % anti-phase, amplitude > 0.06 rad, fingers alternate |
| Idle is restrained | 240 samples × 6 agents | head yaw < 0.45 rad, spine < 0.25 rad, hip drift < 20 mm |
| Workforce is varied and stable | appearance/orientation sweep over 27 agents | deterministic; ≥4 skins, ≥6 hair combinations, ≥10 outfits |
| Colour loyalty to the brand palette | palette arrays in `appearance.ts` | no random hex values at runtime |
| Posture follows operations | status mapping over the real fixture | offline → empty chair; waiting/error → standing beside the desk |
| Stepping out is a walk, not a teleport | R3F scene test, 150 frames | WAITING agent moves 0.45–1.1 m; WORKING agent < 1 cm |
| Seated hips sit on the chair | scene test reads the hip group after 90 frames | 0.42–0.58 m |
| One loop, not 27 | rig registry assertions | 27 handles registered on mount, 0 after unmount |
| Cost | `npm run stats` | 60 meshes per full colleague, 21 compact; cutaway ≈ 2432 submissions |

### Honest limitations of this stage

- **No browser/WebGL review.** The environment has no GPU. Anatomy, proportions, ground contact and desk alignment are
  verified numerically (forward kinematics) and the scene graph is verified headlessly, but the final skinning-free
  look — silhouette, hair readability, clothing contrast at 20 m — has not been judged by eye. The first browser pass
  should be treated as a design review and will likely adjust materials and proportions.
- **Locomotion is desk-local.** Characters stand up, step aside and sit down; they do not yet walk across a floor or
  between floors. There is still no navigation mesh, no door/corridor route and no vertical circulation. The next stage
  adds the route graph (door → corridor → door) and joins it to `moveAgent`.
- **No skeletal skinning.** Because the rig is rigid pieces on joints, elbows and knees show a seam under extreme
  flexion. Poses are clamped to plausible ranges to keep the seams hidden; a skinned GLB could replace the rig without
  changing the behaviour layer.
- **The chair cannot roll or swivel.** It is placed at the workstation anchor with the occupant's facing. A swivel
  animation when a colleague turns to talk is deferred until meeting behaviour exists.
- **Draw cost per person is high** (60 meshes full detail). This is affordable for 27 people but would need merging or
  instancing of clothing parts for a larger workforce.

### Next improvement stage (stage 2)

Stage 2 (section 11) gives the workforce somewhere to go: a real navigation grid, journeys through doors, corridors and
lifts, and an autonomous activity machine per colleague. Stage 3 (section 12) puts what they are doing on their monitors
and gives idle colleagues a life away from the desk.

## 11. Improvement stage 2 — movement and autonomous activities (this iteration)

### What the brief asked for, and what this stage delivered

| Requirement | Delivered |
| --- | --- |
| Agents walk instead of being placed | `navigation.ts` (grid, A\*, lanes) + `journey.ts` (legs, lift, walker) |
| Routes respect walls, doors and furniture | grid carved from real geometry, furniture footprints blocked, doors opened, corner cutting refused |
| No clipping, floating, standing on desks or ending inside chairs | routes end at the seat anchor; the rig is grounded every frame; blocked destinations are reported, not faked |
| Gradual turning, correct stop positions | facing damped at 6–8 s⁻¹; the walker stops exactly on the last waypoint |
| Agent-to-agent avoidance | `avoidanceFor`: slow down within 1.2 m, deterministic id priority, sidestep up to 0.85 m; corridors use planned right-hand lanes |
| Interaction points (chair, desk, monitor, meeting seats) | workstation seat anchors; meeting seats derived from the chairs actually placed around the meeting table, facing the table centre |
| Full animation vocabulary, blended | 13 states, new `TALKING`, `MEETING` and `PICKING_UP` poses, joint-level damping so nothing snaps |
| Role-coherent activities tied to operational state | role families with their own activity sets; status and task drive every transition; nothing is invented about results |
| Per-agent FSM with history and task link | `activity.ts`: status, activity, destination, zone, since, clock, history, task id/title, label and reason |
| Reactive without reloading the scene | `AgentLayer` republishes context on operational change; machines pick it up on the next frame |
| One shared scheduler, no per-agent loop | `activitySystem.stepActivities` then one rig callback in `CharacterAnimator` |
| Floor/camera changes preserve agent state | activities live outside the floor groups; the rig component is keyed by agent id |

### Measured results (this stage)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 188 passed / 188 across 12 files (~7.8 s) |
| Navigation grids | 20.2 ms for five floors; 16 200 cells per floor, ≈ 9 500 walkable |
| Routing throughput | 2.08 ms per seat-to-seat route; 65/65 anchors routable from the lift, 0 adjusted |
| Connectivity | every walkable cell on every floor reachable from the lift (test) |
| Cross-room route | editorial → copy on floor 1: out of the door, 0.55 m lane, back in through the other door, 23.6 m |
| Walk timing | simulated arrival within 0.9–1.25× of `length / 1.05 m/s` |
| Lift journey | floor 1 → floor 3: 2 legs, hidden while riding, 8.4 m elevation change, arrives exactly |
| Crossing | two colleagues walking opposite ways keep ≥ 0.55 m separation (was 0.006 m before the lane fix) |
| Desk-to-desk relocation (headless R3F) | ≤ 0.12 m per frame (no teleport), true path length covered, stops ≤ 0.4 m from the target chair |
| Cross-room relocation (headless R3F) | colleague is still on the floor mid-route and lands within 0.2 m of the new chair |
| Floor-to-floor relocation (headless R3F) | walks to the core, waits, rides the lift, arrives on the new desk within 0.25 m and at the upper elevation |
| Activity FSM | 18 tests: vocabulary, role coherence, task start/finish/change, meetings and seats, determinism, interludes |
| Scheduler | 8 tests: sync/dedup/removal, arrival handover, retargeting, state preserved across camera changes, 27 agents × 1 800 frames in 101 ms |

### Problems found and fixed in this stage (documented because they were real)

1. **Symmetric avoidance produced collisions.** Two agents each stepping aside from the other oscillated: the lateral sign
   flipped frame to frame and the pair passed within 6 mm. Fixed by (a) planning opposing traffic into separate corridor
   lanes, (b) deterministic id priority so only one of the pair yields, (c) reacting only to people on the current line
   of travel, with a dead zone behind.
2. **Sitting down too early.** The FSM used to advance from `WALKING` on a timer, so a colleague could "arrive" before
   the body did. Movement now reports arrival; `WALKING` cannot end until the rig is on the destination.
3. **Stale destinations.** A relocation changed the agent's home seat but the activity kept its old destination until the
   next scheduled block. `stepActivity` now retargets immediately when the destination identity changes.
4. **Teleporting on a failed route.** The first implementation placed the agent at the destination when A\* failed. It now
   keeps the body where it is, logs the reason once, and only accepts a route that ends at a reachable point (flagged
   `adjusted`).

### Mandatory scenarios (1–10) and where they are proven

| # | Scenario | Test |
| --- | --- | --- |
| 1 | Start a task → the colleague works at the desk | `activity > sits down before working when a new task arrives`; `activitySystem > reacts to a task starting and finishing` |
| 2 | Stand up, walk the corridor, sit at another desk | `scene > walks to the new desk when relocated`; `navigation > cross-room route uses doors and the corridor` |
| 3 | Two colleagues cross without colliding | `navigation > lets two colleagues pass each other in the corridor` (≥ 0.55 m) |
| 4 | Enter a meeting room and take a free seat | `activity > walks a convener to the meeting chair, sits, then returns`; `activity > allocates a different chair to every attendee` |
| 5 | Task completion drives the right transition | `activity > stands up, walks, returns and sits when the task finishes` |
| 6 | Task cancelled or changed mid-task / mid-walk | `activity > records a task change mid-task`; `activitySystem > stops a walk and returns home when the task is cancelled mid-route` |
| 7 | Blocked destination → alternative route or honest failure | `navigation > reports an impossible destination honestly`; `routes a chair under a desk to the closest walkable cell`; route-end adjustment is implemented for walled-off goals |
| 8 | Many agents without excessive degradation | `activitySystem > steps all twenty-seven colleagues well inside a frame budget` (0.06 ms/frame) |
| 9 | Floor or camera change preserves agent state | `activitySystem > keeps an agent's history when only the camera or floors change`; `scene > keeps agent state when the visible floor changes` |
| 10 | Re-entry with no duplication | `activitySystem > creates one machine per agent and never duplicates it`; `scene > registers one animation rig per visible colleague and releases it` |

### Honest limitations of this stage

- **Still no browser review.** No GPU is available here. Every claim above comes from unit tests, headless R3F scene
  tests and measured timings — not from watching the scene. Visual smoothness, pose readability at distance and the look
  of a meeting in progress are unverified.
- **Meetings are a deterministic simulation**, not a calendar integration. They are local to the convener's floor, last
  96 s every 7 min, and exist to exercise circulation; they are not evidence of real meetings. No fabricated outcomes:
  nothing is recorded as a result.
- **The route graph has no stairs.** Vertical movement uses the lift (the building has one core). The stair geometry is
  modelled but not walkable.
- **Avoidance is local and pairwise.** It prevents head-on and follow collisions in corridors and open space, but there
  is no global reservation system; a dense crowd around one door could still converge (the sidestep simply decays).
- **The walk cycle is procedural**, not motion-captured, and the rig is unsheeted rigid parts: at a 20 m distance it
  reads as a person, close up it is stylised.
- **Cost per person is unchanged** (60 meshes full, 21 compact). Only the cutaway tier is instanced down; a larger
  workforce would need merging of clothing parts.
- **Off-screen rigs are not culled**: hidden floors unmount their characters (so their machines keep running but no
  meshes exist), yet a visible floor still animates every occupant. Reducing the update rate for agents outside the
  camera frustum is the next optimisation, not something claimed here.

## 12. Improvement stage 3 — live monitors and office life (this iteration)

### What was added

| Feature | Implementation |
| --- | --- |
| Monitors show what each colleague is doing | `scene/character/deskScreens.ts` composes the wording and paints a 320 × 180 canvas per workstation; `DeskScreen.tsx` renders it 24 mm in front of the monitor glass |
| Real-time, without re-rendering React | one registry, repainted by the shared frame loop only when the content key changes (max once per 400 ms per screen) |
| Honest content | name, role, room, status, activity + reason, task title and status, destination (desk / meeting room / on break), wall clock; offline, blocked and failed states say so |
| Desks that read as workplaces | keyboard, mouse, mug and papers modelled on every desk |
| Life away from the desk | staggered breaks (`breakPlan`), real destinations (`breakSpot`: lounge coffee table, else the corridor by the lift), walked out and back by the same FSM |
| Precedence | a running task cancels a break; meetings still win; nothing teleports |

### Measured results (this stage)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 198 passed / 198 across 14 files |
| Screen wording | 4 tests over `screenContentFor`: identity, status, activity, task, clock format, destination labels, honest "no behaviour state" |
| Screens in the scene (headless R3F) | one screen mesh per colleague, registry matches, canvas painted with the real activity label, textures released on unmount |
| Breaks | lounge vs corridor spot selection, distinct spots per colleague, staggered windows that skip offline agents, full walk-out / stand / walk-back sequence, no break while a task runs |
| Movement after this stage | 27 agents: desk work, meetings, breaks, relocations; every trip is a planned route |

### Honest limitations of this stage

- **Still no visual review.** Everything above is verified through unit tests, headless scene-graph tests and measured
  timings. Text size and contrast on a 1 m monitor at a distance has not been judged by eye; the canvas is 320 × 180, so
  at close range the text is crisp but at 20 m it is simply a lit rectangle.
- **Screens are per-monitor textures**, not a shared atlas: ~4 MB of texture memory for a full floor, freed when the
  floor is hidden. A single atlas is the next step if the workforce grows.
- **Breaks are a simulation policy**, not HR data: they exist to make the office feel alive and are not recorded as work.
- **Screen content is a summary**, not the real UI of the agent's tools: it reports the operational state NEXORA actually
  holds, not a fake terminal.
- **No social interaction yet**: colleagues on a break stand on their own spot and do not turn to talk to each other.
  Pair conversations are the obvious next step.
