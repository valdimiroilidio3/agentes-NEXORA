/**
 * Autonomous office activities: the per-agent finite state machine.
 *
 * These tests exercise the behaviour model with simulated time and the real
 * building/agent/task fixtures — no rendering involved.
 */
import { describe, expect, it } from 'vitest';
import { loadBuilding } from '@/domain/building';
import buildingData from '@/data/building.json';
import agentsData from '@/data/agents.json';
import tasksData from '@/data/tasks.json';
import type { Agent, Task } from '@/domain/types';
import {
  ACTIVITY_KINDS,
  BREAK_CYCLE,
  BREAK_LENGTH,
  breakPlan,
  breakSpot,
  MEETING_CYCLE,
  MEETING_LENGTH,
  ROLE_ACTIVITIES,
  allocateMeetingSeats,
  animationFor,
  createActivity,
  deskActivityFor,
  describeActivity,
  meetingPlan,
  meetingSeats,
  roleFamily,
  stepActivity,
  type ActivityContext,
  type AgentActivity,
  type MeetingSlot,
} from '@/scene/character/activity';

const { building } = loadBuilding(buildingData as unknown);
const agents = (agentsData as { agents: Agent[] }).agents;
const tasks = (tasksData as { tasks: Task[] }).tasks;

interface Placement {
  readonly agent: Agent;
  readonly floorId: string;
  readonly roomId: string;
  readonly seat: { x: number; z: number };
  readonly facing: number;
}

const placements = new Map<string, Placement>();
for (const floor of building.floors) {
  for (const room of floor.rooms) {
    for (const station of room.workstations) {
      const agent = agents.find((item) => item.workstationId === station.id);
      if (!agent) continue;
      placements.set(agent.id, {
        agent,
        floorId: floor.id,
        roomId: room.id,
        seat: station.seat,
        facing: station.rotationY + Math.PI,
      });
    }
  }
}

function taskFor(agent: Agent): Task | null {
  const id = agent.currentTaskId;
  if (!id) return null;
  return tasks.find((task) => task.id === id) ?? null;
}

function contextFor(
  agentId: string,
  overrides: Partial<ActivityContext> = {},
): ActivityContext {
  const placement = placements.get(agentId);
  if (!placement) throw new Error(`No placement for ${agentId}`);
  return {
    agent: placement.agent,
    task: taskFor(placement.agent),
    homeFloorId: placement.floorId,
    homeRoomId: placement.roomId,
    homeSeat: placement.seat,
    homeFacing: placement.facing,
    meeting: null,
    atDestination: true,
    ...overrides,
  };
}

/** Runs the FSM for `seconds` at 30 fps with an optional context patch. */
function run(
  activity: AgentActivity,
  ctx: ActivityContext,
  seconds: number,
  dt = 1 / 30,
): { activity: AgentActivity; seen: AgentActivity['activity'][] } {
  let current = activity;
  const seen: AgentActivity['activity'][] = [];
  const steps = Math.round(seconds / dt);
  for (let index = 0; index < steps; index += 1) {
    current = stepActivity(current, ctx, dt);
    const last = seen[seen.length - 1];
    if (last !== current.activity) seen.push(current.activity);
  }
  return { activity: current, seen };
}

describe('activity vocabulary', () => {
  it('covers the thirteen required animation states exactly once', () => {
    expect(ACTIVITY_KINDS).toHaveLength(13);
    expect(new Set(ACTIVITY_KINDS).size).toBe(13);
    expect(ACTIVITY_KINDS).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it('maps every state to a real pose-library animation', () => {
    for (const kind of ACTIVITY_KINDS) {
      const animation = animationFor(kind);
      expect(['SEATED', 'STANDING', 'TRANSIT']).toContain(animation.posture);
      expect(typeof animation.seated).toBe('string');
      expect(typeof animation.standing).toBe('string');
      if (kind === 'MEETING') expect(animation.seated).toBe('MEETING');
      if (kind === 'TALKING') expect(animation.seated).toBe('TALKING');
      if (kind === 'PICKING_UP') expect(animation.standing).toBe('PICKING_UP');
      if (kind === 'STANDING_UP' || kind === 'PICKING_UP') expect(animation.posture).not.toBe('SEATED');
    }
  });
});

describe('role coherence', () => {
  it('classifies every agent into the family its title implies', () => {
    const expected: Record<string, string> = {
      'agent-nova': 'engineering',
      'agent-muse': 'design',
      'agent-ledger': 'analysis',
      'agent-atria': 'commercial',
      'agent-sovereign': 'management',
      'agent-lyra': 'support',
    };
    for (const [id, family] of Object.entries(expected)) {
      const agent = agents.find((item) => item.id === id);
      expect(agent, id).toBeDefined();
      expect(roleFamily(agent!.role), agent!.role).toBe(family);
    }
    for (const agent of agents) {
      expect(['engineering', 'design', 'analysis', 'commercial', 'management', 'support']).toContain(
        roleFamily(agent.role),
      );
    }
  });

  it('only picks desk activities the role actually performs', () => {
    for (const agent of agents) {
      const family = roleFamily(agent.role);
      const allowed = ROLE_ACTIVITIES[family];
      for (let block = 0; block < 40; block += 1) {
        expect(allowed).toContain(deskActivityFor(family, block * 7 + 3, block));
      }
    }
    expect(ROLE_ACTIVITIES.engineering).not.toContain('MEETING');
    expect(ROLE_ACTIVITIES.management).toContain('MEETING');
  });

  it('ties a working agent to the task that is actually running', () => {
    const ctx = contextFor('agent-atria');
    expect(ctx.task).not.toBeNull();
    const activity = createActivity(ctx);
    expect(ROLE_ACTIVITIES[activity.family]).toContain(activity.activity);
    expect(activity.reason).toContain(ctx.task!.title);
    expect(activity.taskId).toBe(ctx.task!.id);
    expect(activity.operational).toBe('WORKING');
  });
});

describe('operational states', () => {
  it('hides offline colleagues and keeps their chair empty', () => {
    const activity = createActivity(contextFor('agent-sentinel'));
    expect(activity.visible).toBe(false);
    expect(activity.activity).toBe('IDLE');
    const stepped = stepActivity(activity, contextFor('agent-sentinel'), 1);
    expect(stepped.visible).toBe(false);
  });

  it('stands a blocked agent beside the desk in a waiting pose', () => {
    const ctx = contextFor('agent-relay');
    const activity = createActivity(ctx);
    expect(activity.animation.posture).toBe('STANDING');
    expect(activity.animation.standing).toBe('WAITING');
    expect(activity.label).toBe('Waiting on a dependency');
  });

  it('stands a failed agent up to review the failure', () => {
    const ctx = contextFor('agent-cadence');
    const activity = createActivity(ctx);
    expect(activity.animation.posture).toBe('STANDING');
    expect(activity.animation.standing).toBe('ERROR_REVIEW');
    expect(activity.reason.length).toBeGreaterThan(10);
  });
});

describe('task driven transitions', () => {
  it('sits down before working when a new task arrives at the desk', () => {
    const idle = contextFor('agent-echo', { task: null });
    let activity = createActivity(idle);
    expect(activity.activity).toBe('IDLE');
    const working = contextFor('agent-echo', {
      task: { ...tasks[0]!, id: 'task-test-echo', title: 'Draft the launch note', agentId: 'agent-echo' },
    });
    const { activity: after, seen } = run(activity, working, 6);
    expect(seen[0]).toBe('SITTING_DOWN');
    expect(seen).toContain('SITTING');
    expect(['TYPING', 'READING', 'THINKING', 'TALKING']).toContain(after.activity);
    expect(after.taskId).toBe('task-test-echo');
  });

  it('stands up, walks, returns and sits when the task finishes', () => {
    const working = contextFor('agent-atria');
    let activity = createActivity(working);
    const first = run(activity, working, 3);
    activity = first.activity;
    const finished = contextFor('agent-atria', { task: null, atDestination: false });
    const { activity: after, seen } = run(activity, finished, 12);
    expect(seen[0]).toBe('STANDING_UP');
    expect(seen).toContain('WALKING');
    expect(after.activity).toBe('WALKING');

    const home = run(after, { ...finished, atDestination: true }, 6);
    expect(home.seen).toContain('SITTING_DOWN');
    expect(home.seen).toContain('SITTING');
    expect(home.activity.activity).toBe('IDLE');
    expect(home.activity.taskId).toBeNull();
  });

  it('records a task change mid-walk and keeps one coherent history', () => {
    const working = contextFor('agent-helios');
    let activity = createActivity(working);
    activity = run(activity, working, 4).activity;
    const swapped = contextFor('agent-helios', {
      task: { ...tasks[1]!, id: 'task-test-helios', title: 'Re-check cluster headroom', agentId: 'agent-helios' },
    });
    const { activity: after } = run(activity, swapped, 1);
    const change = after.history.find((event) => event.reason.includes('changed to'));
    expect(change, after.history.map((event) => event.reason).join(' | ')).toBeDefined();
    expect(change!.reason).toContain('Re-check cluster headroom');
    expect(after.taskId).toBe('task-test-helios');
    expect(after.history.length).toBeLessThanOrEqual(14);
  });

  it('never fabricates a work result for a task without one', () => {
    for (const agent of agents) {
      const task = taskFor(agent);
      const activity = createActivity(contextFor(agent.id));
      if (task && agent.status !== 'WAITING' && agent.status !== 'ERROR') {
        expect(activity.reason).toContain(task.title);
      }
      expect(activity.reason.length).toBeGreaterThan(8);
      expect(activity.reason.toLowerCase()).not.toContain('completed all');
      expect(activity.reason.toLowerCase()).not.toContain('successfully');
      expect(describeActivity(activity)).toContain('—');
    }
  });
});

describe('meeting rooms', () => {
  const floor = building.floors.find((item) => item.rooms.some((room) => room.template === 'meeting-room'))!;
  const room = floor.rooms.find((item) => item.template === 'meeting-room')!;

  it('derives seats from the real chairs, facing the table', () => {
    const seats = meetingSeats(building, floor.id, room.id);
    expect(seats.length).toBeGreaterThanOrEqual(6);
    const table = room.furniture.find((item) => item.kind === 'meeting-table')!;
    for (const seat of seats) {
      const dx = table.position.x - seat.point.x;
      const dz = table.position.z - seat.point.z;
      const toTable = Math.atan2(dx, dz);
      let delta = Math.abs(toTable - seat.facing);
      while (delta > Math.PI) delta = Math.abs(delta - Math.PI * 2);
      expect(delta).toBeLessThan(0.001);
      expect(Math.hypot(dx, dz)).toBeLessThan(2.8);
    }
  });

  it('allocates a different chair to every attendee and respects capacity', () => {
    const seats = meetingSeats(building, floor.id, room.id);
    const attendees = ['agent-sovereign', 'agent-vector', 'agent-cadence', 'agent-atlas', 'agent-orion', 'agent-vega', 'agent-sable'];
    const allocation = allocateMeetingSeats(building, floor.id, room.id, attendees);
    expect(allocation.size).toBe(seats.length);
    const used = new Set([...allocation.values()].map((seat) => seat.chairId));
    expect(used.size).toBe(allocation.size);
    for (const seat of allocation.values()) expect(seat.roomId).toBe(room.id);
  });

  it('convenes only management roles, on their own floor, with a real seat', () => {
    let seen = 0;
    for (let elapsed = 0; elapsed < MEETING_CYCLE * 2; elapsed += 5) {
      const plan = meetingPlan(building, agents, elapsed);
      for (const [agentId, slot] of plan) {
        const placement = placements.get(agentId)!;
        expect(roleFamily(placement.agent.role)).toBe('management');
        expect(slot.floorId).toBe(placement.floorId);
        const seats = meetingSeats(building, slot.floorId, slot.roomId);
        expect(seats.map((seat) => seat.chairId)).toContain(slot.chairId);
        expect(slot.endAt - elapsed).toBeLessThanOrEqual(MEETING_LENGTH);
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('walks a convener to the meeting chair, sits, then returns', () => {
    let activity: AgentActivity | null = null;
    let slot: MeetingSlot | null = null;
    for (let elapsed = 0; elapsed < MEETING_CYCLE && !activity; elapsed += 1) {
      const plan = meetingPlan(building, agents, elapsed);
      const entry = [...plan].find(([id]) => roleFamily(placements.get(id)!.agent.role) === 'management');
      if (!entry) continue;
      const [agentId, found] = entry;
      slot = found;
      activity = createActivity(contextFor(agentId, { meeting: found, atDestination: false }));
    }
    expect(activity, 'a management agent convenes within one cycle').not.toBeNull();
    const agentId = activity!.agentId;
    const ctx = contextFor(agentId, { meeting: slot, atDestination: false });

    const rise = run(activity!, ctx, 2);
    expect(rise.seen[0]).toBe('STANDING_UP');
    expect(rise.activity.activity).toBe('WALKING');
    expect(rise.activity.destination.kind).toBe('meeting');

    const arrived = run(rise.activity, { ...ctx, atDestination: true }, 1);
    expect(arrived.activity.activity).toBe('MEETING');
    expect(arrived.activity.animation.seated).toBe('MEETING');

    const held = run(arrived.activity, { ...ctx, atDestination: true }, 20);
    expect(held.activity.activity).toBe('MEETING');

    const over = run(held.activity, contextFor(agentId, { atDestination: false }), 12);
    expect(over.seen).toContain('STANDING_UP');
    expect(over.activity.activity).toBe('WALKING');
    expect(over.activity.destination.kind).toBe('workstation');
    const back = run(over.activity, contextFor(agentId, { atDestination: true }), 8);
    expect(back.seen).toContain('SITTING_DOWN');
    expect(back.activity.activity).toBe('IDLE');
  });
});

describe('breaks and circulation', () => {
  const groundFloor = building.floors[0]!;
  const techFloor = building.floors[3]!;

  it('uses the lounge coffee table where there is one, the corridor otherwise', () => {
    const lounge = groundFloor.rooms.find((room) => room.template === 'lounge');
    expect(lounge).toBeDefined();
    const spot = breakSpot(building, groundFloor, 'agent-lyra')!;
    expect(spot.roomId).toBe(lounge!.id);
    expect(spot.label).toBe('Lounge');
    const table = lounge!.furniture.find((item) => item.kind === 'coffee-table')!;
    expect(Math.hypot(spot.point.x - table.position.x, spot.point.z - table.position.z)).toBeLessThan(1.6);

    expect(techFloor.rooms.some((room) => room.template === 'lounge')).toBe(false);
    const corridor = breakSpot(building, techFloor, 'agent-nova')!;
    expect(corridor.label).toBe('Corridor');
    expect(Math.abs(corridor.point.z)).toBeLessThan(1.8);
  });

  it('gives two colleagues different squares to stand on', () => {
    const a = breakSpot(building, techFloor, 'agent-nova')!;
    const b = breakSpot(building, techFloor, 'agent-kernel')!;
    expect(Math.hypot(a.point.x - b.point.x, a.point.z - b.point.z)).toBeGreaterThan(0.2);
  });

  it('schedules staggered windows and skips offline colleagues', () => {
    const plan = new Map<string, ReturnType<typeof breakPlan> extends Map<string, infer T> ? T : never>();
    for (let elapsed = 0; elapsed < BREAK_CYCLE; elapsed += 5) {
      for (const [id, slot] of breakPlan(building, agents, elapsed)) {
        plan.set(id, slot);
        expect(slot.endAt - elapsed).toBeLessThanOrEqual(BREAK_LENGTH);
      }
      expect(breakPlan(building, agents, elapsed).has('agent-sentinel')).toBe(false);
    }
    expect(plan.size).toBeGreaterThan(5);
  });

  it('walks an idle colleague out of the chair, stands on the break spot, and comes back', () => {
    const base = contextFor('agent-nova', {
      task: null,
      agent: { ...contextFor('agent-nova').agent, status: 'IDLE', currentTaskId: null },
    });
    const slot = breakSpot(building, techFloor, 'agent-nova')!;
    const onBreak = { ...slot, startAt: 0, endAt: 40 };
    const ctx: ActivityContext = { ...base, break: onBreak, atDestination: false };

    let activity = createActivity(ctx);
    activity = run(activity, ctx, 0.25).activity;
    expect(activity.activity).toBe('STANDING_UP');
    const walking = run(activity, ctx, 1).activity;
    expect(walking.activity).toBe('WALKING');
    expect(walking.destination.kind).toBe('break');
    expect(walking.destination.point).toEqual(slot.point);

    const standing = stepActivity(walking, { ...ctx, atDestination: true }, 0.1);
    expect(standing.activity).toBe('IDLE');
    expect(standing.animation.posture).toBe('STANDING');
    expect(standing.label).toBe('On a short break');
    const held = run(standing, { ...ctx, atDestination: true }, 10).activity;
    expect(held.label).toBe('On a short break');

    // Break over: stand, walk home, sit.
    const over = run(held, { ...base, atDestination: false }, 2).activity;
    expect(over.destination.kind).toBe('workstation');
    expect(['STANDING_UP', 'WALKING']).toContain(over.activity);
    const back = run(over, { ...base, atDestination: true }, 8).activity;
    expect(['SITTING_DOWN', 'SITTING', 'IDLE']).toContain(back.activity);
  });

  it('does not take a break while a task is running', () => {
    const ctx = contextFor('agent-atria');
    const slot = breakSpot(building, techFloor, 'agent-atria')!;
    const busy = { ...ctx, break: { ...slot, startAt: 0, endAt: 60 } };
    const activity = run(createActivity(busy), busy, 5).activity;
    expect(activity.destination.kind).toBe('workstation');
    expect(activity.label).not.toBe('On a short break');
  });
});

describe('autonomy', () => {
  it('is deterministic and staggered across colleagues', () => {
    const a = contextFor('agent-kernel');
    const b = contextFor('agent-syntax');
    const first = run(createActivity(a), a, 120).activity;
    const second = run(createActivity(a), a, 120).activity;
    expect(second.activity).toBe(first.activity);
    expect(second.history.map((event) => event.activity)).toEqual(
      first.history.map((event) => event.activity),
    );
    const other = run(createActivity(b), b, 120).activity;
    expect(other.agentId).not.toBe(first.agentId);
  });

  it('reaches for something every so often without leaving the role set', () => {
    const ctx = contextFor('agent-nova');
    const { seen } = run(createActivity(ctx), ctx, 300);
    expect(seen).toContain('PICKING_UP');
    for (const kind of seen) {
      expect([
        ...ROLE_ACTIVITIES.engineering,
        'PICKING_UP',
        'RETURNING_TO_WORK',
        'SITTING_DOWN',
        'SITTING',
        'IDLE',
      ]).toContain(kind);
    }
  });
});
