/**
 * Desk monitors: the wording each screen shows for its occupant.
 *
 * The canvas painting itself needs a 2D context (covered by the scene tests);
 * this file covers the content rules, which are what a reader of the screen
 * actually relies on.
 */
import { describe, expect, it } from 'vitest';
import { loadBuilding } from '@/domain/building';
import buildingData from '@/data/building.json';
import agentsData from '@/data/agents.json';
import tasksData from '@/data/tasks.json';
import type { Agent, Task } from '@/domain/types';
import { createActivity, type ActivityContext } from '@/scene/character/activity';
import { screenContentFor } from '@/scene/character/deskScreens';

const { building } = loadBuilding(buildingData as unknown);
const agents = (agentsData as { agents: Agent[] }).agents;
const tasks = (tasksData as { tasks: Task[] }).tasks;

function contextFor(agentId: string): ActivityContext {
  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      for (const station of room.workstations) {
        if (station.id !== agents.find((agent) => agent.id === agentId)?.workstationId) continue;
        const agent = agents.find((candidate) => candidate.id === agentId)!;
        return {
          agent,
          task: agent.currentTaskId
            ? (tasks.find((task) => task.id === agent.currentTaskId) ?? null)
            : null,
          homeFloorId: floor.id,
          homeRoomId: room.id,
          homeSeat: station.seat,
          homeFacing: station.rotationY + Math.PI,
          meeting: null,
          break: null,
          atDestination: true,
        };
      }
    }
  }
  throw new Error(`No workstation for ${agentId}`);
}

const at = new Date('2026-10-25T09:41:07.000Z');

describe('screen content', () => {
  it('shows who sits there and what they are doing right now', () => {
    const ctx = contextFor('agent-atria');
    const activity = createActivity(ctx);
    const content = screenContentFor({
      agent: ctx.agent,
      task: ctx.task,
      roomName: 'Sales · Leads',
      activity,
      at,
    });
    expect(content.agentName).toBe('Atria');
    expect(content.role).toBe(ctx.agent.role);
    expect(content.roomName).toBe('Sales · Leads');
    expect(content.statusLabel).toBe('working');
    expect(content.activityLabel).toBe(activity.label);
    expect(content.activityKind).toBe(activity.activity);
    expect(content.activityDetail).toBe(activity.reason);
    expect(content.taskTitle).toBe(ctx.task!.title);
    expect(content.taskStatus).toBe('running');
    expect(content.destination).toBe('at the desk');
  });

  it('is honest when the colleague has no task and no scene', () => {
    const agent = agents.find((candidate) => candidate.id === 'agent-echo')!;
    const content = screenContentFor({
      agent,
      task: null,
      roomName: 'Copy room',
      activity: null,
      at,
    });
    expect(content.taskTitle).toBeNull();
    expect(content.taskStatus).toBeNull();
    expect(content.activityLabel).toBe('No behaviour state');
    expect(content.activityKind).toBe('UNKNOWN');
  });

  it('formats a padded wall clock', () => {
    const agent = agents[0]!;
    const content = screenContentFor({
      agent,
      task: null,
      roomName: 'Reception',
      activity: null,
      at: new Date(2026, 9, 25, 7, 4, 3),
    });
    expect(content.clock).toBe('07:04:03');
  });

  it('labels a meeting or a break instead of pretending to be at the desk', () => {
    const ctx = contextFor('agent-iris');
    const meeting = createActivity({ ...ctx, task: null });
    const withMeeting = {
      ...meeting,
      destination: {
        ...meeting.destination,
        kind: 'meeting' as const,
        chairId: 'chair-1',
      },
    };
    expect(
      screenContentFor({ agent: ctx.agent, task: null, roomName: 'R', activity: withMeeting, at })
        .destination,
    ).toBe('meeting room');

    const onBreak = {
      ...meeting,
      destination: { ...meeting.destination, kind: 'break' as const },
    };
    expect(
      screenContentFor({ agent: ctx.agent, task: null, roomName: 'R', activity: onBreak, at })
        .destination,
    ).toBe('on break');
  });
});
