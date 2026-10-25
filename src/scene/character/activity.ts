/**
 * Autonomous office activities.
 *
 * A deterministic, per-agent finite state machine that turns *real* NEXORA
 * operational state (an agent's status and the task system) into an activity,
 * a destination and an animation state. Nothing here invents work results: the
 * FSM only decides where a colleague is and what their body is doing, and it
 * always cites the operational fact that caused the transition.
 *
 * The module is pure and environment-agnostic (no React, no Three.js) so the
 * whole behaviour model can be unit tested with simulated time.
 */
import type { Agent, AgentStatus, Building, Floor, Room, Task, Vec2 } from '@/domain/types';
import type { SeatedActivity, StandingActivity } from './pose';
import { hashString, seededRandom } from './appearance';
import { liftAnchor } from './navigation';

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/**
 * The complete animation vocabulary. Every state is reachable from the FSM and
 * every transition is blended by the pose engine — poses never snap.
 */
export type ActivityKind =
  | 'IDLE'
  | 'WALKING'
  | 'TURNING'
  | 'SITTING_DOWN'
  | 'SITTING'
  | 'STANDING_UP'
  | 'TYPING'
  | 'READING'
  | 'THINKING'
  | 'TALKING'
  | 'MEETING'
  | 'PICKING_UP'
  | 'RETURNING_TO_WORK';

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'IDLE',
  'WALKING',
  'TURNING',
  'SITTING_DOWN',
  'SITTING',
  'STANDING_UP',
  'TYPING',
  'READING',
  'THINKING',
  'TALKING',
  'MEETING',
  'PICKING_UP',
  'RETURNING_TO_WORK',
];

export type Posture = 'SEATED' | 'STANDING' | 'TRANSIT';

export interface ActivityAnimation {
  readonly seated: SeatedActivity;
  readonly standing: StandingActivity;
  readonly posture: Posture;
}

/**
 * Activity → joint animation. Seated work states reuse the seated pose
 * library; standing states use the standing library; transit states lean on
 * the walk cycle when the walker is actually moving.
 */
export function animationFor(kind: ActivityKind): ActivityAnimation {
  switch (kind) {
    case 'TYPING':
      return { seated: 'TYPING', standing: 'IDLE_STANDING', posture: 'SEATED' };
    case 'READING':
      return { seated: 'READING_SCREEN', standing: 'IDLE_STANDING', posture: 'SEATED' };
    case 'THINKING':
      return { seated: 'THINKING', standing: 'IDLE_STANDING', posture: 'SEATED' };
    case 'TALKING':
      return { seated: 'TALKING', standing: 'IDLE_STANDING', posture: 'SEATED' };
    case 'MEETING':
      return { seated: 'MEETING', standing: 'IDLE_STANDING', posture: 'SEATED' };
    case 'SITTING':
      return { seated: 'IDLE_SEATED', standing: 'IDLE_STANDING', posture: 'SEATED' };
    case 'SITTING_DOWN':
      return { seated: 'IDLE_SEATED', standing: 'IDLE_STANDING', posture: 'SEATED' };
    case 'STANDING_UP':
      return { seated: 'IDLE_SEATED', standing: 'IDLE_STANDING', posture: 'STANDING' };
    case 'PICKING_UP':
      return { seated: 'IDLE_SEATED', standing: 'PICKING_UP', posture: 'STANDING' };
    case 'IDLE':
      return { seated: 'IDLE_SEATED', standing: 'IDLE_STANDING', posture: 'SEATED' };
    default:
      return { seated: 'IDLE_SEATED', standing: 'IDLE_STANDING', posture: 'TRANSIT' };
  }
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

export type RoleFamily =
  | 'engineering'
  | 'design'
  | 'analysis'
  | 'commercial'
  | 'management'
  | 'support';

const ROLE_KEYWORDS: ReadonlyArray<readonly [RoleFamily, readonly string[]]> = [
  ['engineering', ['engineer', 'developer', 'platform', 'infrastructure', 'frontend', 'integration', 'automation', 'qa']],
  ['design', ['designer', 'art director', 'brand', 'creative']],
  ['analysis', ['analyst', 'researcher', 'strategy', 'finance', 'curator', 'quality']],
  ['commercial', ['account', 'sales', 'proposal', 'client', 'qualification', 'relations']],
  ['management', ['manager', 'chief', 'orchestrator', 'dispatcher', 'coordinator', 'director', 'lead']],
  ['support', ['host', 'security', 'reception', 'supervisor']],
];

export function roleFamily(role: string): RoleFamily {
  const value = role.toLowerCase();
  for (const [family, keywords] of ROLE_KEYWORDS) {
    if (keywords.some((keyword) => value.includes(keyword))) return family;
  }
  return 'support';
}

/**
 * Activity set a role family actually performs at a desk. Ordered by how
 * typical it is, so the seeded schedule favours the representative ones.
 */
export const ROLE_ACTIVITIES: Readonly<Record<RoleFamily, readonly ActivityKind[]>> = {
  engineering: ['TYPING', 'TYPING', 'READING', 'THINKING'],
  design: ['TYPING', 'THINKING', 'THINKING', 'READING'],
  analysis: ['READING', 'TYPING', 'THINKING', 'READING'],
  commercial: ['TALKING', 'TYPING', 'READING', 'TALKING'],
  management: ['MEETING', 'TALKING', 'READING', 'THINKING'],
  support: ['TYPING', 'TALKING', 'READING', 'THINKING'],
};

export function deskActivityFor(family: RoleFamily, seed: number, block: number): ActivityKind {
  const options = ROLE_ACTIVITIES[family];
  const random = seededRandom(hashString(`desk:${family}:${seed}:${block}`));
  const index = Math.min(options.length - 1, Math.floor(random() * options.length));
  return options[index] ?? 'TYPING';
}

/* ------------------------------------------------------------------ */
/* Meeting rooms                                                       */
/* ------------------------------------------------------------------ */

export interface MeetingSeat {
  readonly floorId: string;
  readonly roomId: string;
  readonly chairId: string;
  readonly point: Vec2;
  /** Facing that turns the occupant toward the table, i.e. the other seats. */
  readonly facing: number;
}

/**
 * Seats in a meeting room, derived from the chairs actually placed around the
 * meeting table. Occupants sit on the chair axis and face the table centre so
 * that everybody is oriented toward everybody else.
 */
export function meetingSeats(building: Building, floorId: string, roomId: string): MeetingSeat[] {
  const floor = building.floors.find((item) => item.id === floorId);
  const room = floor?.rooms.find((item) => item.id === roomId);
  if (!floor || !room || room.template !== 'meeting-room') return [];
  const table = room.furniture.find((item) => item.kind === 'meeting-table');
  const centre = table ? table.position : { x: room.rect.x, z: room.rect.z };
  const seats: MeetingSeat[] = [];
  for (const chair of room.furniture) {
    if (chair.kind !== 'chair') continue;
    const dx = centre.x - chair.position.x;
    const dz = centre.z - chair.position.z;
    const length = Math.hypot(dx, dz) || 1;
    // Sit slightly back from the chair origin along the chair's own axis.
    const back = 0.42;
    seats.push({
      floorId,
      roomId,
      chairId: chair.id,
      point: {
        x: chair.position.x - (dx / length) * back,
        z: chair.position.z - (dz / length) * back,
      },
      facing: Math.atan2(dx / length, dz / length),
    });
  }
  return seats.sort((a, b) => (a.chairId < b.chairId ? -1 : a.chairId > b.chairId ? 1 : 0));
}

/**
 * Deterministic seat allocation: attendees sorted by id, seats sorted by id,
 * each attendee takes the next free seat in their room. No seat is handed out
 * twice, so two colleagues never end up on the same chair.
 */
export function allocateMeetingSeats(
  building: Building,
  floorId: string,
  roomId: string,
  attendeeIds: readonly string[],
): Map<string, MeetingSeat> {
  const seats = meetingSeats(building, floorId, roomId);
  const allocation = new Map<string, MeetingSeat>();
  const attendees = [...attendeeIds].sort();
  for (let index = 0; index < attendees.length && index < seats.length; index += 1) {
    const seat = seats[index];
    const id = attendees[index];
    if (seat && id) allocation.set(id, seat);
  }
  return allocation;
}

export function meetingRooms(floor: Floor): Room[] {
  return floor.rooms.filter((room) => room.template === 'meeting-room');
}

/** Length of one simulated meeting cycle, in seconds. */
export const MEETING_CYCLE = 420;
export const MEETING_LENGTH = 96;

export interface MeetingSlot {
  readonly floorId: string;
  readonly roomId: string;
  readonly chairId: string;
  readonly point: Vec2;
  readonly facing: number;
  readonly startAt: number;
  readonly endAt: number;
}

/**
 * Meeting plan for the whole workforce.
 *
 * Only management roles convene (the operational fixture has no meeting tasks);
 * each convener gets a staggered window inside its own cycle so meetings never
 * start or end together. Rooms are chosen on the convener's own floor, which
 * keeps meetings local and the lift free for real relocations.
 */
export function meetingPlan(
  building: Building,
  agents: readonly Agent[],
  elapsed: number,
): Map<string, MeetingSlot> {
  const plan = new Map<string, MeetingSlot>();
  if (elapsed < 0) return plan;
  const requests = new Map<string, string[]>();

  for (const agent of agents) {
    if (agent.status === 'OFFLINE' || agent.status === 'ERROR') continue;
    if (roleFamily(agent.role) !== 'management') continue;
    const offset = Math.floor(seededRandom(hashString(`meeting:${agent.id}`))() * (MEETING_CYCLE - MEETING_LENGTH - 40));
    const window = elapsed - offset;
    if (window < 0) continue;
    const cycle = Math.floor(window / MEETING_CYCLE);
    const local = window - cycle * MEETING_CYCLE;
    if (local > MEETING_LENGTH) continue;
    const floor = building.floors.find((item) => item.rooms.some((room) => room.id === agent.roomId));
    if (!floor) continue;
    const rooms = meetingRooms(floor);
    if (rooms.length === 0) continue;
    const room = rooms[cycle % rooms.length];
    if (!room) continue;
    const key = `${floor.id}/${room.id}`;
    const list = requests.get(key) ?? [];
    list.push(agent.id);
    requests.set(key, list);
    plan.set(agent.id, {
      floorId: floor.id,
      roomId: room.id,
      chairId: '',
      point: { x: 0, z: 0 },
      facing: 0,
      startAt: elapsed,
      endAt: elapsed + (MEETING_LENGTH - local),
    });
  }

  for (const [key, attendeeIds] of requests) {
    const [floorId, roomId] = key.split('/');
    if (!floorId || !roomId) continue;
    const allocation = allocateMeetingSeats(building, floorId, roomId, attendeeIds);
    for (const [agentId, seat] of allocation) {
      const slot = plan.get(agentId);
      if (!slot) continue;
      plan.set(agentId, { ...slot, chairId: seat.chairId, point: seat.point, facing: seat.facing });
    }
    // Attendees who did not get a chair stay at their desks instead of
    // standing on top of somebody.
    for (const agentId of attendeeIds) {
      if (!allocation.has(agentId)) plan.delete(agentId);
    }
  }
  return plan;
}

/* ------------------------------------------------------------------ */
/* Breaks                                                              */
/* ------------------------------------------------------------------ */

export interface BreakSlot {
  readonly floorId: string;
  readonly roomId: string;
  readonly point: Vec2;
  readonly facing: number;
  readonly startAt: number;
  readonly endAt: number;
  readonly label: string;
}

/** One break cycle per colleague, staggered; breaks last roughly half a minute. */
export const BREAK_CYCLE = 300;
export const BREAK_LENGTH = 34;

/**
 * Where a colleague stretches their legs: the lounge coffee table when the
 * floor has one, otherwise the corridor by the lift core. Deterministic per
 * agent, so two colleagues on break do not occupy the same square metre.
 */
export function breakSpot(building: Building, floor: Floor, agentId: string): BreakSlot | null {
  const random = seededRandom(hashString(`break-spot:${agentId}`));
  const lounge = floor.rooms.find((room) => room.template === 'lounge');
  if (lounge) {
    const anchor =
      lounge.furniture.find((item) => item.kind === 'coffee-table') ??
      lounge.furniture.find((item) => item.kind === 'sofa');
    const centre = anchor ? anchor.position : { x: lounge.rect.x, z: lounge.rect.z };
    const angle = random() * Math.PI * 2;
    const radius = 1.05;
    const point = {
      x: centre.x + Math.cos(angle) * radius,
      z: centre.z + Math.sin(angle) * radius,
    };
    return {
      floorId: floor.id,
      roomId: lounge.id,
      point,
      facing: Math.atan2(centre.x - point.x, centre.z - point.z),
      startAt: 0,
      endAt: 0,
      label: 'Lounge',
    };
  }
  const anchor = liftAnchor(floor);
  if (!anchor) return null;
  const core = floor.rooms.find((room) => room.template === 'core') ?? floor.rooms[0];
  if (!core) return null;
  // A short walk down the corridor, spread over a few metres of its length.
  const offset = (random() - 0.5) * 5;
  // Stand off the traffic lane, still inside the 3.6 m corridor band.
  const point = { x: anchor.x + offset, z: 0.95 };
  return {
    floorId: floor.id,
    roomId: core.id,
    point,
    facing: offset >= 0 ? -Math.PI / 2 : Math.PI / 2,
    startAt: 0,
    endAt: 0,
    label: 'Corridor',
  };
}

/**
 * Break windows for the whole workforce. Only colleagues who are not offline,
 * failed or holding a task ever leave their desk for one (the FSM re-checks the
 * task, so a job that arrives mid-break wins).
 */
export function breakPlan(
  building: Building,
  agents: readonly Agent[],
  elapsed: number,
): Map<string, BreakSlot> {
  const plan = new Map<string, BreakSlot>();
  if (elapsed < 0) return plan;
  for (const agent of agents) {
    if (agent.status === 'OFFLINE' || agent.status === 'ERROR') continue;
    const offset = Math.floor(
      seededRandom(hashString(`break:${agent.id}`))() * (BREAK_CYCLE - BREAK_LENGTH - 40),
    );
    const window = elapsed - offset;
    if (window < 0) continue;
    const cycle = Math.floor(window / BREAK_CYCLE);
    const local = window - cycle * BREAK_CYCLE;
    if (local > BREAK_LENGTH) continue;
    const floor = building.floors.find((item) =>
      item.rooms.some((room) => room.id === agent.roomId),
    );
    if (!floor) continue;
    const spot = breakSpot(building, floor, agent.id);
    if (!spot) continue;
    plan.set(agent.id, { ...spot, startAt: elapsed, endAt: elapsed + (BREAK_LENGTH - local) });
  }
  return plan;
}

/* ------------------------------------------------------------------ */
/* Activity state                                                      */
/* ------------------------------------------------------------------ */

export interface ActivityEvent {
  /** FSM clock, seconds since the agent's activity machine started. */
  readonly at: number;
  readonly activity: ActivityKind;
  readonly reason: string;
}

export interface ActivityDestination {
  readonly kind: 'workstation' | 'meeting' | 'break';
  readonly floorId: string;
  readonly roomId: string;
  readonly point: Vec2;
  readonly facing: number;
  readonly chairId: string | null;
}

export interface ActivityContext {
  readonly agent: Agent;
  readonly task: Task | null;
  readonly homeFloorId: string;
  readonly homeRoomId: string;
  readonly homeSeat: Vec2;
  readonly homeFacing: number;
  readonly meeting: MeetingSlot | null;
  readonly break?: BreakSlot | null;
  /**
   * Whether the body has reached the activity destination. Movement is owned
   * by the nav/journey layer, which reports arrival truthfully; the FSM only
   * decides what to do once the body is there.
   */
  readonly atDestination: boolean;
}

export interface AgentActivity {
  readonly agentId: string;
  readonly role: string;
  readonly family: RoleFamily;
  readonly operational: AgentStatus;
  readonly taskId: string | null;
  readonly taskTitle: string | null;
  readonly activity: ActivityKind;
  readonly animation: ActivityAnimation;
  readonly destination: ActivityDestination;
  readonly label: string;
  readonly reason: string;
  /** Seconds spent in the current activity. */
  readonly since: number;
  /** FSM clock, seconds. */
  readonly clock: number;
  readonly history: readonly ActivityEvent[];
  /** True while the agent should be drawn. Offline colleagues are not. */
  readonly visible: boolean;
}

const HISTORY_LIMIT = 14;

/** How long each non-looping state lasts, in seconds. */
export const TRANSITION_SECONDS = {
  SITTING_DOWN: 0.6,
  SITTING: 1.4,
  STANDING_UP: 0.55,
  PICKING_UP: 2.6,
  RETURNING_TO_WORK: 2.4,
} as const;

/** Work blocks before a colleague reaches for something on the floor. */
const PICK_UP_EVERY = 4;

/** Stable identity of a destination, used to detect changes without floats. */
export function destinationId(destination: ActivityDestination): string {
  return [
    destination.kind,
    destination.floorId,
    destination.roomId,
    destination.point.x.toFixed(2),
    destination.point.z.toFixed(2),
    destination.chairId ?? '',
  ].join('|');
}

const BREAK_ANIMATION: ActivityAnimation = {
  seated: 'IDLE_SEATED',
  standing: 'IDLE_STANDING',
  posture: 'STANDING',
};

/**
 * Pose for an activity at a destination. Standing somewhere that is not a
 * desk (a lounge sofa, the corridor by the lift) must not read as sitting.
 */
export function animationForDestination(
  destination: ActivityDestination,
  kind: ActivityKind,
): ActivityAnimation {
  return destination.kind === 'break' ? BREAK_ANIMATION : animationFor(kind);
}

function breakDestination(ctx: ActivityContext, slot: BreakSlot): ActivityDestination {
  return {
    kind: 'break',
    floorId: slot.floorId,
    roomId: slot.roomId,
    point: slot.point,
    facing: slot.facing,
    chairId: null,
  };
}

function homeDestination(ctx: ActivityContext): ActivityDestination {
  return {
    kind: 'workstation',
    floorId: ctx.homeFloorId,
    roomId: ctx.homeRoomId,
    point: ctx.homeSeat,
    facing: ctx.homeFacing,
    chairId: null,
  };
}

function meetingDestination(ctx: ActivityContext, slot: MeetingSlot): ActivityDestination {
  return {
    kind: 'meeting',
    floorId: slot.floorId,
    roomId: slot.roomId,
    point: slot.point,
    facing: slot.facing,
    chairId: slot.chairId,
  };
}

function record(
  history: readonly ActivityEvent[],
  clock: number,
  activity: ActivityKind,
  reason: string,
): ActivityEvent[] {
  const next = [...history, { at: clock, activity, reason }];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

function build(
  ctx: ActivityContext,
  previous: AgentActivity | null,
  kind: ActivityKind,
  reason: string,
  destinationOverride?: ActivityDestination,
): AgentActivity {
  const family = roleFamily(ctx.agent.role);
  const clock = previous?.clock ?? 0;
  const meeting = ctx.meeting;
  const onBreak = ctx.break && !ctx.task && ctx.agent.status === 'IDLE' ? ctx.break : null;
  const destination =
    destinationOverride ??
    (meeting
      ? meetingDestination(ctx, meeting)
      : onBreak
        ? breakDestination(ctx, onBreak)
        : homeDestination(ctx));
  return {
    agentId: ctx.agent.id,
    role: ctx.agent.role,
    family,
    operational: ctx.agent.status,
    taskId: ctx.task?.id ?? null,
    taskTitle: ctx.task?.title ?? null,
    activity: kind,
    animation: animationForDestination(destination, kind),
    destination,
    label: destination.kind === 'break' ? 'On a short break' : labelFor(kind, ctx),
    reason,
    since: 0,
    clock,
    history: record(previous?.history ?? [], clock, kind, reason),
    visible: ctx.agent.status !== 'OFFLINE',
  };
}

function labelFor(kind: ActivityKind, ctx: ActivityContext): string {
  switch (kind) {
    case 'TYPING':
      return 'Typing at the workstation';
    case 'READING':
      return 'Reading on screen';
    case 'THINKING':
      return 'Thinking through a problem';
    case 'TALKING':
      return 'Talking with a colleague';
    case 'MEETING':
      return 'In a meeting';
    case 'PICKING_UP':
      return 'Picking something up';
    case 'RETURNING_TO_WORK':
      return 'Returning to the workstation';
    case 'SITTING_DOWN':
      return 'Sitting down';
    case 'STANDING_UP':
      return 'Standing up';
    case 'SITTING':
      return 'Seated at the workstation';
    case 'WALKING':
      return 'Walking';
    case 'TURNING':
      return 'Turning';
    default:
      return ctx.task ? 'At the desk, between steps' : 'At the desk, idle';
  }
}

/** Statuses that genuinely leave the chair. */
interface AwayActivity {
  readonly activity: ActivityKind;
  readonly animation: ActivityAnimation;
  readonly label: string;
  readonly reason: string;
}

/** Statuses that genuinely leave the chair, with the pose that explains it. */
function awayActivity(ctx: ActivityContext): AwayActivity | null {
  const status = ctx.agent.status;
  if (status === 'WAITING') {
    return {
      activity: 'IDLE',
      animation: { seated: 'IDLE_SEATED', standing: 'WAITING', posture: 'STANDING' },
      label: 'Waiting on a dependency',
      reason: 'Blocked until a prerequisite task completes, so the agent waits beside the desk.',
    };
  }
  if (status === 'ERROR') {
    return {
      activity: 'THINKING',
      animation: { seated: 'READING_SCREEN', standing: 'ERROR_REVIEW', posture: 'STANDING' },
      label: 'Reviewing a failure',
      reason: ctx.task?.error?.message ?? 'The last run failed; the agent stepped away to review it.',
    };
  }
  return null;
}

export function createActivity(ctx: ActivityContext): AgentActivity {
  const away = awayActivity(ctx);
  if (away) {
    const built = build(ctx, null, away.activity, away.reason);
    return { ...built, animation: away.animation, label: away.label };
  }
  if (ctx.agent.status === 'OFFLINE') {
    return { ...build(ctx, null, 'IDLE', 'Agent is offline; the chair stays empty.'), visible: false };
  }
  const seated = ctx.task ? deskActivityFor(roleFamily(ctx.agent.role), hashString(ctx.agent.id) % 97, 0) : 'IDLE';
  const reason = ctx.task ? `Task “${ctx.task.title}” is in progress.` : 'No assigned work; the agent stays at its workstation.';
  // A machine always starts at the desk: meetings and breaks are walked to,
  // never teleported into.
  return build(ctx, null, seated, reason, homeDestination(ctx));
}

/**
 * Advances one agent's activity machine.
 *
 * Precedence is deliberate and ordered: operational facts (offline, blocked,
 * failed) beat schedule, schedule beats task churn, and task churn beats the
 * seeded desk rhythm. Transitional states are always played out in full, and
 * walking never ends before the nav layer reports that the body arrived.
 */
export function stepActivity(
  activity: AgentActivity,
  ctx: ActivityContext,
  dt: number,
): AgentActivity {
  const step = Math.max(0, dt);
  const clock = activity.clock + step;
  const since = activity.since + step;
  const current: AgentActivity = { ...activity, clock, since };
  const home = homeDestination(ctx);

  const advance = (kind: ActivityKind, reason: string, destination?: ActivityDestination): AgentActivity => {
    const next = build(ctx, current, kind, reason, destination);
    return { ...next, clock, since: 0 };
  };

  // 1. Offline: no body on the floor at all.
  if (ctx.agent.status === 'OFFLINE') {
    if (current.activity === 'IDLE' && !current.visible) return current;
    return { ...advance('IDLE', 'Agent is offline; the chair stays empty.'), visible: false };
  }

  // 2. Blocked or failed: leave the chair and hold the pose that explains it.
  const away = awayActivity(ctx);
  if (away) {
    if (current.label === away.label) return { ...current, animation: away.animation, visible: true };
    const next = build(ctx, current, away.activity, away.reason);
    return {
      ...next,
      clock,
      since: 0,
      animation: away.animation,
      label: away.label,
      visible: true,
    };
  }

  const meetingDestinationNow = ctx.meeting ? meetingDestination(ctx, ctx.meeting) : null;

  // 3. The operational assignment moved (another desk, another room, a meeting
  // seat): retarget immediately without disturbing the activity itself.
  const desiredDestination = meetingDestinationNow ?? home;
  if (
    current.activity !== 'WALKING' &&
    destinationId(current.destination) !== destinationId(desiredDestination) &&
    current.destination.kind === desiredDestination.kind
  ) {
    return { ...current, destination: desiredDestination, clock, since };
  }

  // 4. A meeting is due: get up and walk to the allocated chair.
  if (meetingDestinationNow) {
    if (current.activity === 'MEETING') {
      return { ...current, destination: meetingDestinationNow };
    }
    if (current.activity === 'WALKING') {
      if (!ctx.atDestination) return { ...current, destination: meetingDestinationNow };
      const next = advance('MEETING', 'Arrived at the meeting room and took the allocated seat.', meetingDestinationNow);
      return next;
    }
    if (current.activity === 'STANDING_UP') {
      if (since < TRANSITION_SECONDS.STANDING_UP) return current;
      const next = advance('WALKING', 'Walking to the meeting room.', meetingDestinationNow);
      return next;
    }
    return advance('STANDING_UP', 'A meeting is due; standing up from the desk.', meetingDestinationNow);
  }

  // 4. A meeting just ended: get up, walk back, sit down, resume.
  if (current.destination.kind === 'meeting' && current.activity !== 'RETURNING_TO_WORK') {
    if (current.activity === 'STANDING_UP') {
      if (since < TRANSITION_SECONDS.STANDING_UP) return { ...current, destination: home };
      return advance('WALKING', 'Leaving the meeting room.', home);
    }
    return advance('STANDING_UP', 'The meeting finished; standing up.', home);
  }

  // 5. Task assigned, finished, replaced or cancelled.
  const taskId = ctx.task?.id ?? null;
  if (current.taskId !== taskId) {
    const reason = ctx.task
      ? current.taskId
        ? `Task changed to “${ctx.task.title}”.`
        : `Task “${ctx.task.title}” was assigned to the agent.`
      : current.taskId
        ? 'The task finished; the agent gets up before starting anything new.'
        : 'Task cleared.';
    if (ctx.task && current.animation.posture === 'SEATED' && !current.taskId) {
      return advance('SITTING_DOWN', reason);
    }
    return advance('STANDING_UP', reason);
  }

  // 6. Idle colleagues take a short break away from the desk, then come back.
  const breakSlot = ctx.break && !ctx.task && ctx.agent.status === 'IDLE' ? ctx.break : null;
  const breakDestinationNow = breakSlot ? breakDestination(ctx, breakSlot) : null;

  if (breakDestinationNow) {
    if (current.destination.kind === 'break') {
      if (current.activity === 'STANDING_UP') {
        if (since < TRANSITION_SECONDS.STANDING_UP) return current;
        return advance('WALKING', 'Walking to the break area.', breakDestinationNow);
      }
      if (current.activity === 'WALKING') {
        if (!ctx.atDestination) return { ...current, destination: breakDestinationNow };
        return advance('IDLE', 'On a short break, away from the desk.', breakDestinationNow);
      }
      return {
        ...current,
        destination: breakDestinationNow,
        animation: BREAK_ANIMATION,
        label: 'On a short break',
      };
    }
    if (current.activity === 'STANDING_UP') {
      if (since < TRANSITION_SECONDS.STANDING_UP) return current;
      return advance('WALKING', 'Walking to the break area.', breakDestinationNow);
    }
    return advance('STANDING_UP', 'Taking a short break.', breakDestinationNow);
  }

  if (current.destination.kind === 'break') {
    if (current.activity === 'STANDING_UP') {
      if (since < TRANSITION_SECONDS.STANDING_UP) return { ...current, destination: home };
      return advance('WALKING', 'Break over; heading back to the desk.', home);
    }
    if (current.activity === 'WALKING') {
      if (!ctx.atDestination) return { ...current, destination: home };
      return advance('SITTING_DOWN', 'Back at the desk after a break.', home);
    }
    return advance('STANDING_UP', 'Break over; standing up.', home);
  }

  switch (current.activity) {
    case 'STANDING_UP': {
      if (since < TRANSITION_SECONDS.STANDING_UP) return current;
      return advance(ctx.atDestination ? 'RETURNING_TO_WORK' : 'WALKING', 'Moving away from the desk.');
    }
    case 'WALKING': {
      if (!ctx.atDestination) return current;
      const meeting = current.destination.kind === 'meeting';
      return advance(
        meeting ? 'MEETING' : 'SITTING_DOWN',
        meeting ? 'Arrived at the meeting room.' : 'Arrived at the workstation.',
      );
    }
    case 'MEETING': {
      return current;
    }
    case 'RETURNING_TO_WORK': {
      if (!ctx.atDestination) return { ...current, activity: 'WALKING' };
      if (since < TRANSITION_SECONDS.RETURNING_TO_WORK) return current;
      return advance('SITTING_DOWN', 'Back at the workstation.');
    }
    case 'SITTING_DOWN': {
      if (since < TRANSITION_SECONDS.SITTING_DOWN) return current;
      return advance('SITTING', 'Seated at the desk.');
    }
    case 'PICKING_UP': {
      if (since < TRANSITION_SECONDS.PICKING_UP) return current;
      return advance('RETURNING_TO_WORK', 'Lifted what was needed; back to the desk.');
    }
    case 'SITTING': {
      if (since < TRANSITION_SECONDS.SITTING) return current;
      return advance(
        ctx.task ? deskActivityFor(current.family, hashString(current.agentId) % 97, 0) : 'IDLE',
        ctx.task ? `Task “${ctx.task.title}” is in progress.` : 'No assigned work; staying at the workstation.',
      );
    }
    default: {
      // Desk work: seeded, role-coherent rhythm with the occasional reach for
      // something beside the desk. Two colleagues never share a block length.
      const blockSeconds = 22 + (hashString(current.agentId) % 9);
      const block = Math.floor(clock / blockSeconds);
      const previousBlock = Math.floor(activity.clock / blockSeconds);
      if (block === previousBlock) return current;
      if (block % PICK_UP_EVERY === 0) {
        return advance('PICKING_UP', 'Reaching for something beside the desk.');
      }
      if (!ctx.task) {
        return current.activity === 'IDLE' ? current : advance('IDLE', 'No assigned work.');
      }
      return advance(
        deskActivityFor(current.family, hashString(current.agentId) % 97, block),
        `Task “${ctx.task.title}” is in progress.`,
      );
    }
  }
}

/** Row for the Inspector: what the body is doing and why. */
export function describeActivity(activity: AgentActivity): string {
  const meeting = activity.destination.kind === 'meeting' ? ' (meeting room)' : '';
  return `${activity.label}${meeting} — ${activity.reason}`;
}
