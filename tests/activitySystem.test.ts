/**
 * The shared activity scheduler.
 *
 * These tests cover the wiring that the pure FSM cannot see: contexts being
 * published, arrival being reported truthfully by the body, state surviving a
 * floor change, re-entry without duplication, and the per-frame cost of the
 * whole workforce.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { loadBuilding } from '@/domain/building';
import buildingData from '@/data/building.json';
import agentsData from '@/data/agents.json';
import tasksData from '@/data/tasks.json';
import type { Agent, Task } from '@/domain/types';
import { meetingSeats, type ActivityContext, type MeetingSlot } from '@/scene/character/activity';
import {
  activityClock,
  activityCount,
  activityFor,
  agentActivity,
  destinationKey,
  reportArrival,
  resetActivities,
  setActivityBuilding,
  setMeetingSource,
  stepActivities,
  syncActivities,
} from '@/scene/character/activitySystem';

const { building } = loadBuilding(buildingData as unknown);
const agents = (agentsData as { agents: Agent[] }).agents;
const tasks = (tasksData as { tasks: Task[] }).tasks;

const roomIndex = new Map<string, { floorId: string; roomId: string; seat: { x: number; z: number }; facing: number }>();
for (const floor of building.floors) {
  for (const room of floor.rooms) {
    for (const station of room.workstations) {
      roomIndex.set(station.id, {
        floorId: floor.id,
        roomId: room.id,
        seat: station.seat,
        facing: station.rotationY + Math.PI,
      });
    }
  }
}

function contextsFor(ids: readonly string[]): ActivityContext[] {
  const wanted = ids.length === 0 ? agents : agents.filter((agent) => ids.includes(agent.id));
  const out: ActivityContext[] = [];
  for (const agent of wanted) {
    const spot = roomIndex.get(agent.workstationId ?? '');
    if (!spot) continue;
    out.push({
      agent,
      task: agent.currentTaskId
        ? (tasks.find((task) => task.id === agent.currentTaskId) ?? null)
        : null,
      homeFloorId: spot.floorId,
      homeRoomId: spot.roomId,
      homeSeat: spot.seat,
      homeFacing: spot.facing,
      meeting: null,
      atDestination: true,
    });
  }
  return out;
}

/** Advances the shared scheduler by simulated seconds at 60 fps. */
function advance(seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let index = 0; index < steps; index += 1) stepActivities(1 / 60);
}

beforeEach(() => {
  resetActivities();
  setActivityBuilding(building);
});

describe('publishing operational state', () => {
  it('creates one machine per agent and never duplicates it', () => {
    const contexts = contextsFor([]);
    expect(contexts.length).toBe(27);
    syncActivities(contexts);
    expect(activityCount()).toBe(27);
    syncActivities(contexts);
    syncActivities(contexts.map((context) => ({ ...context })));
    expect(activityCount()).toBe(27);
    expect(new Set([...agents.map((agent) => agent.id)]).size).toBe(27);
  });

  it('forgets agents that leave the building', () => {
    const contexts = contextsFor([]);
    syncActivities(contexts);
    const first = contexts[0]!;
    syncActivities(contexts.slice(1));
    expect(activityCount()).toBe(26);
    expect(agentActivity(first.agent.id)).toBeNull();
  });

  it('keeps an agent’s history when only the camera or floors change', () => {
    const contexts = contextsFor([]);
    syncActivities(contexts);
    advance(10);
    const before = agentActivity('agent-nova')!;
    expect(before.history.length).toBeGreaterThan(0);
    // Hiding floors or moving the camera does not republish contexts at all;
    // publishing the identical context must not reset the machine either.
    syncActivities(contexts.map((context) => ({ ...context })));
    expect(agentActivity('agent-nova')!.history.length).toBeGreaterThan(0);
    expect(agentActivity('agent-nova')!.clock).toBeCloseTo(before.clock, 5);
  });

  it('reacts to a task starting and finishing without a reload', () => {
    const idle: ActivityContext = {
      ...contextsFor(['agent-echo'])[0]!,
      task: null,
    };
    syncActivities([idle]);
    advance(2);
    const task = { ...tasks[0]!, id: 'task-live-echo', title: 'Draft the launch note', agentId: 'agent-echo' };
    syncActivities([{ ...idle, agent: { ...idle.agent, status: 'WORKING', currentTaskId: task.id }, task }]);
    advance(6);
    const working = agentActivity('agent-echo')!;
    expect(working.taskId).toBe('task-live-echo');
    expect(['TYPING', 'READING', 'THINKING', 'TALKING']).toContain(working.activity);

    syncActivities([{ ...idle, agent: { ...idle.agent, status: 'IDLE', currentTaskId: null }, task: null }]);
    advance(0.2);
    expect(agentActivity('agent-echo')!.activity).toBe('STANDING_UP');
    advance(12);
    expect(agentActivity('agent-echo')!.taskId).toBeNull();
    expect(['IDLE', 'SITTING', 'SITTING_DOWN']).toContain(agentActivity('agent-echo')!.activity);
  });
});

describe('movement handover', () => {
  it('stands, walks and only sits once the body reports arrival', () => {
    const base = contextsFor(['agent-iris'])[0]!;
    const floor = building.floors.find(
      (item) => item.id === base.homeFloorId && item.rooms.some((room) => room.template === 'meeting-room'),
    )!;
    const room = floor.rooms.find((item) => item.template === 'meeting-room')!;
    const seat = meetingSeats(building, floor.id, room.id)[0]!;
    const slot: MeetingSlot = {
      floorId: seat.floorId,
      roomId: seat.roomId,
      chairId: seat.chairId,
      point: seat.point,
      facing: seat.facing,
      startAt: 0,
      endAt: 120,
    };
    setMeetingSource(() => new Map([['agent-iris', slot]]));
    syncActivities([{ ...base, meeting: slot }]);

    advance(0.2);
    expect(agentActivity('agent-iris')!.activity).toBe('STANDING_UP');
    advance(1);
    const walking = agentActivity('agent-iris')!;
    expect(walking.activity).toBe('WALKING');
    expect(walking.destination.kind).toBe('meeting');
    expect(walking.destination.point).toEqual(seat.point);

    // The body is still on its way: the machine must not sit down early.
    advance(6);
    expect(agentActivity('agent-iris')!.activity).toBe('WALKING');

    reportArrival('agent-iris');
    advance(0.2);
    expect(agentActivity('agent-iris')!.activity).toBe('MEETING');

    // Meeting ends: the machine sends the body home again.
    setMeetingSource(() => new Map());
    advance(3);
    expect(agentActivity('agent-iris')!.destination.kind).toBe('workstation');
    expect(['STANDING_UP', 'WALKING']).toContain(agentActivity('agent-iris')!.activity);
    advance(2);
    expect(agentActivity('agent-iris')!.activity).toBe('WALKING');
    reportArrival('agent-iris');
    advance(5);
    expect(['SITTING_DOWN', 'SITTING', 'IDLE']).toContain(agentActivity('agent-iris')!.activity);
  });

  it('plans a walk again when the destination changes mid-route', () => {
    const contexts = contextsFor(['agent-castor']);
    const base = contexts[0]!;
    const first = contextsFor(['agent-atria'])[0]!;
    syncActivities([{ ...base, homeSeat: first.homeSeat, homeRoomId: first.homeRoomId }]);
    advance(1);
    const before = agentActivity('agent-castor')!;
    expect(destinationKey(before.destination)).toContain(first.homeSeat.x.toFixed(2));

    // Destination cancelled back to the original desk: a new destination key,
    // so the rig replans rather than finishing the stale route.
    syncActivities([base]);
    advance(0.1);
    const after = agentActivity('agent-castor')!;
    expect(after.destination.kind).toBe('workstation');
    expect(destinationKey(after.destination)).not.toBe(destinationKey(before.destination));
    expect(destinationKey(after.destination)).toContain(base.homeSeat.x.toFixed(2));
  });
});

describe('interruptions', () => {
  it('stops a walk and returns home when the task is cancelled mid-route', () => {
    const base = contextsFor(['agent-nova'])[0]!;
    const task = { ...tasks[3]!, id: 'task-live-nova', title: 'Profile the render pipeline', agentId: 'agent-nova' };
    const working: ActivityContext = {
      ...base,
      agent: { ...base.agent, status: 'WORKING', currentTaskId: task.id },
      task,
    };
    syncActivities([working]);
    advance(1);
    // Force a walk by moving the desk: the machine retargets and the body walks.
    const far = contextsFor(['agent-helios'])[0]!;
    syncActivities([{ ...working, homeFloorId: far.homeFloorId, homeRoomId: far.homeRoomId, homeSeat: far.homeSeat }]);
    advance(0.2);
    expect(agentActivity('agent-nova')!.destination.roomId).toBe(far.homeRoomId);

    // Task cancelled while the colleague is on its way.
    syncActivities([
      {
        ...working,
        homeFloorId: far.homeFloorId,
        homeRoomId: far.homeRoomId,
        homeSeat: far.homeSeat,
        task: null,
        agent: { ...base.agent, status: 'IDLE', currentTaskId: null },
      },
    ]);
    advance(0.2);
    const cancelled = agentActivity('agent-nova')!;
    expect(cancelled.taskId).toBeNull();
    expect(cancelled.history.some((event) => event.reason.includes('finished'))).toBe(true);
    expect(cancelled.destination.kind).toBe('workstation');
  });
});

describe('scale', () => {
  it('steps all twenty-seven colleagues well inside a frame budget', () => {
    syncActivities(contextsFor([]));
    advance(1);
    const started = performance.now();
    advance(30); // 1 800 frames, half a minute of office life
    const elapsed = performance.now() - started;
    const perFrame = elapsed / 1800;
    expect(activityCount()).toBe(27);
    // Budget: the scheduler must not dominate a 16 ms frame.
    expect(perFrame).toBeLessThan(2);
  });

  it('keeps activity clocks monotonic and shared', () => {
    syncActivities(contextsFor([]));
    advance(5);
    const clock = activityClock();
    advance(5);
    expect(activityClock()).toBeGreaterThan(clock);
    for (const agent of agents) {
      const activity = activityFor(agent.id)!;
      expect(activity.clock).toBeLessThanOrEqual(activityClock() + 0.001);
    }
  });
});
