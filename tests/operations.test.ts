import { describe, expect, it } from 'vitest';
import buildingFixture from '@/data/building.json';
import agentsFixture from '@/data/agents.json';
import tasksFixture from '@/data/tasks.json';
import { loadBuilding } from '@/domain/building';
import { parseAgents, parseTasks } from '@/domain/schema';
import { validateAssignments, derivedAgentStatus } from '@/domain/agents';
import {
  assignTask,
  cancelTask,
  completeTask,
  createOperationsState,
  failTask,
  moveAgent,
  progressTask,
  retryTask,
  setAgentStatus,
  startTask,
  waitTask,
  type OperationsState,
} from '@/domain/operations';
import type { Agent, Room, Task } from '@/domain/types';

const { building } = loadBuilding(buildingFixture);
const agents = parseAgents(agentsFixture);
const tasks = parseTasks(tasksFixture);

function baseState(): OperationsState {
  return createOperationsState(tasks, agents);
}

function fixtureTask(id: string): Task {
  const found = tasks.find((task) => task.id === id);
  if (!found) throw new Error(`missing fixture task ${id}`);
  return found;
}

function fixtureAgent(id: string): Agent {
  const found = agents.find((agent) => agent.id === id);
  if (!found) throw new Error(`missing fixture agent ${id}`);
  return found;
}

describe('fixture assignment integrity', () => {
  it('has no assignment errors', () => {
    const issues = validateAssignments(building, agents, tasks);
    const errors = issues.filter((issue) => issue.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('sits every agent at an existing workstation in its room', () => {
    for (const agent of agents) {
      const room = building.floors.flatMap((floor) => floor.rooms).find((r) => r.id === agent.roomId);
      expect(room, `room for ${agent.id}`).toBeTruthy();
      expect(room?.workstations.some((ws) => ws.id === agent.workstationId)).toBe(true);
    }
  });

  it('detects a workstation conflict', () => {
    const broken: Agent[] = [agents[0]!, { ...agents[1]!, roomId: agents[0]!.roomId, workstationId: agents[0]!.workstationId }];
    const issues = validateAssignments(building, broken, []);
    expect(issues.some((issue) => issue.code === 'agent.workstationConflict')).toBe(true);
  });

  it('detects a missing room reference', () => {
    const broken: Agent[] = [{ ...agents[0]!, roomId: 'missing-room' }];
    const issues = validateAssignments(building, broken, []);
    expect(issues.some((issue) => issue.code === 'agent.roomMissing')).toBe(true);
  });
});

describe('task lifecycle through the engine', () => {
  it('starts a queued task and marks the agent as working', () => {
    const state = baseState();
    const result = startTask(state, { taskId: 'task-queue-001', at: '2026-10-25T10:00:00.000Z' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = result.state.tasks.find((candidate) => candidate.id === 'task-queue-001');
    const agent = result.state.agents.find((candidate) => candidate.id === task?.agentId);
    expect(task?.status).toBe('RUNNING');
    expect(task?.startedAt).toBe('2026-10-25T10:00:00.000Z');
    expect(agent?.status).toBe('WORKING');
    expect(agent?.currentTaskId).toBe('task-queue-001');
    expect(result.event.type).toBe('TASK_STARTED');
    expect(result.state.events.at(-1)?.type).toBe('TASK_STARTED');
  });

  it('refuses a second execution of a running task', () => {
    const first = startTask(baseState(), { taskId: 'task-queue-001', at: '2026-10-25T10:00:00.000Z' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = startTask(first.state, { taskId: 'task-queue-001', at: '2026-10-25T10:01:00.000Z' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('INVALID_TRANSITION');
  });

  it('blocks a task whose dependency is incomplete', () => {
    const state = baseState();
    const blockedState: OperationsState = {
      ...state,
      tasks: state.tasks.map((task) =>
        task.id === 'task-queue-001' ? { ...task, dependsOn: ['task-queue-003'] } : task,
      ),
    };
    const result = startTask(blockedState, { taskId: 'task-queue-001', at: '2026-10-25T10:00:00.000Z' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DEPENDENCIES_UNMET');
  });

  it('completes a task, frees the agent and records the result', () => {
    const started = startTask(baseState(), { taskId: 'task-queue-001', at: '2026-10-25T10:00:00.000Z' });
    if (!started.ok) throw new Error(started.message);
    const completed = completeTask(started.state, {
      taskId: 'task-queue-001',
      at: '2026-10-25T10:02:00.000Z',
      result: {
        summary: 'Refactor landed in 3 commits.',
        simulated: true,
        source: 'demo-adapter',
        metrics: { commits: 3 },
      },
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    const task = completed.state.tasks.find((candidate) => candidate.id === 'task-queue-001');
    const agent = completed.state.agents.find((candidate) => candidate.id === 'agent-nova');
    expect(task?.status).toBe('COMPLETED');
    expect(task?.completedAt).toBe('2026-10-25T10:02:00.000Z');
    expect(task?.result?.simulated).toBe(true);
    expect(agent?.status).toBe('IDLE');
    expect(agent?.currentTaskId).toBeNull();
    expect(completed.event.type).toBe('TASK_COMPLETED');
  });

  it('fails a task and puts the agent into ERROR', () => {
    const started = startTask(baseState(), { taskId: 'task-queue-001', at: '2026-10-25T10:00:00.000Z' });
    if (!started.ok) throw new Error(started.message);
    const failed = failTask(started.state, {
      taskId: 'task-queue-001',
      at: '2026-10-25T10:01:00.000Z',
      error: { code: 'SIMULATED_FAILURE', message: 'injected', retryable: true },
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    const task = failed.state.tasks.find((candidate) => candidate.id === 'task-queue-001');
    const agent = failed.state.agents.find((candidate) => candidate.id === 'agent-nova');
    expect(task?.status).toBe('FAILED');
    expect(task?.error?.code).toBe('SIMULATED_FAILURE');
    expect(task?.result).toBeNull();
    expect(agent?.status).toBe('ERROR');
    expect(agent?.currentTaskId).toBeNull();
  });

  it('re-queues a retryable failure and rejects a non-retryable one', () => {
    const started = startTask(baseState(), { taskId: 'task-queue-001', at: '2026-10-25T10:00:00.000Z' });
    if (!started.ok) throw new Error(started.message);
    const failed = failTask(started.state, {
      taskId: 'task-queue-001',
      at: '2026-10-25T10:01:00.000Z',
      error: { code: 'X', message: 'boom', retryable: true },
    });
    if (!failed.ok) throw new Error(failed.message);
    const retried = retryTask(failed.state, { taskId: 'task-queue-001', at: '2026-10-25T10:05:00.000Z' });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    const task = retried.state.tasks.find((candidate) => candidate.id === 'task-queue-001');
    expect(task?.status).toBe('QUEUED');
    expect(task?.error).toBeNull();
    expect(task?.startedAt).toBeNull();

    const blocked = retryTask(
      {
        ...failed.state,
        tasks: failed.state.tasks.map((candidate) =>
          candidate.id === 'task-queue-001'
            ? { ...candidate, status: 'FAILED', error: { code: 'FATAL', message: 'no', retryable: false } }
            : candidate,
        ),
      },
      { taskId: 'task-queue-001', at: '2026-10-25T10:06:00.000Z' },
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe('NOT_RETRYABLE');
  });

  it('refuses to complete a task that never started', () => {
    const result = completeTask(baseState(), {
      taskId: 'task-queue-001',
      at: '2026-10-25T10:00:00.000Z',
      result: { summary: 'fake', simulated: true, source: 'demo-adapter' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });

  it('cancels a running task and releases the agent', () => {
    const started = startTask(baseState(), { taskId: 'task-queue-001', at: '2026-10-25T10:00:00.000Z' });
    if (!started.ok) throw new Error(started.message);
    const cancelled = cancelTask(started.state, { taskId: 'task-queue-001', at: '2026-10-25T10:01:00.000Z' });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    const task = cancelled.state.tasks.find((candidate) => candidate.id === 'task-queue-001');
    const agent = cancelled.state.agents.find((candidate) => candidate.id === 'agent-nova');
    expect(task?.status).toBe('FAILED');
    expect(task?.error?.code).toBe('CANCELLED');
    expect(agent?.status).toBe('IDLE');
    expect(cancelled.event.type).toBe('TASK_CANCELLED');
  });

  it('moves a running task into WAITING and back', () => {
    const started = startTask(baseState(), { taskId: 'task-queue-001', at: '2026-10-25T10:00:00.000Z' });
    if (!started.ok) throw new Error(started.message);
    const waiting = waitTask(started.state, {
      taskId: 'task-queue-001',
      at: '2026-10-25T10:01:00.000Z',
      reason: 'waiting for upstream contract',
    });
    expect(waiting.ok).toBe(true);
    if (!waiting.ok) return;
    const task = waiting.state.tasks.find((candidate) => candidate.id === 'task-queue-001');
    const agent = waiting.state.agents.find((candidate) => candidate.id === 'agent-nova');
    expect(task?.status).toBe('WAITING');
    expect(agent?.status).toBe('WAITING');

    const resumed = startTask(waiting.state, { taskId: 'task-queue-001', at: '2026-10-25T10:05:00.000Z' });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.state.tasks.find((candidate) => candidate.id === 'task-queue-001')?.status).toBe('RUNNING');
  });

  it('ignores progress for a task that is not running', () => {
    const result = progressTask(baseState(), {
      taskId: 'task-queue-001',
      at: '2026-10-25T10:00:00.000Z',
      message: 'should be ignored',
      simulated: true,
    });
    expect(result.ok).toBe(false);
  });

  it('records progress without changing status', () => {
    const started = startTask(baseState(), { taskId: 'task-queue-001', at: '2026-10-25T10:00:00.000Z' });
    if (!started.ok) throw new Error(started.message);
    const progressed = progressTask(started.state, {
      taskId: 'task-queue-001',
      at: '2026-10-25T10:00:30.000Z',
      message: 'Reading the task brief…',
      simulated: true,
    });
    expect(progressed.ok).toBe(true);
    if (!progressed.ok) return;
    const task = progressed.state.tasks.find((candidate) => candidate.id === 'task-queue-001');
    expect(task?.status).toBe('RUNNING');
    expect(progressed.event.type).toBe('TASK_PROGRESS');
  });

  it('refuses to run a task for an offline agent', () => {
    const state = baseState();
    const task = fixtureTask('task-queue-003');
    const offline: OperationsState = {
      ...state,
      agents: state.agents.map((agent) =>
        agent.id === task.agentId ? { ...agent, status: 'OFFLINE' as const } : agent,
      ),
    };
    const result = startTask(offline, { taskId: task.id, at: '2026-10-25T10:00:00.000Z' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AGENT_OFFLINE');
  });

  it('refuses to run an unassigned task', () => {
    const state = baseState();
    const unassigned: OperationsState = {
      ...state,
      tasks: state.tasks.map((task) =>
        task.id === 'task-queue-001' ? { ...task, agentId: null } : task,
      ),
    };
    const result = startTask(unassigned, { taskId: 'task-queue-001', at: '2026-10-25T10:00:00.000Z' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TASK_UNASSIGNED');
  });
});

describe('agent operations', () => {
  it('never clears a task through a status change', () => {
    const state = baseState();
    const busy = state.agents.find((agent) => agent.currentTaskId);
    expect(busy).toBeTruthy();
    if (!busy) return;
    const result = setAgentStatus(state, { agentId: busy.id, status: 'IDLE', at: '2026-10-25T10:00:00.000Z' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AGENT_BUSY');
  });

  it('only allows operator-driven offline/idle/error states', () => {
    const result = setAgentStatus(baseState(), {
      agentId: 'agent-atlas',
      status: 'WORKING',
      at: '2026-10-25T10:00:00.000Z',
    });
    expect(result.ok).toBe(false);
  });

  it('takes an idle agent offline', () => {
    const result = setAgentStatus(baseState(), {
      agentId: 'agent-atlas',
      status: 'OFFLINE',
      at: '2026-10-25T10:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.agents.find((agent) => agent.id === 'agent-atlas')?.status).toBe('OFFLINE');
  });

  it('re-assigns a queued task together with its room', () => {
    const target = fixtureAgent('agent-kernel');
    const result = assignTask(baseState(), {
      taskId: 'task-queue-001',
      agentId: target.id,
      at: '2026-10-25T10:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = result.state.tasks.find((candidate) => candidate.id === 'task-queue-001');
    expect(task?.agentId).toBe(target.id);
    expect(task?.roomId).toBe(target.roomId);
  });

  it('refuses to re-assign a running task', () => {
    const result = assignTask(baseState(), {
      taskId: 'task-run-001',
      agentId: 'agent-nova',
      at: '2026-10-25T10:00:00.000Z',
    });
    expect(result.ok).toBe(false);
  });

  it('moves an idle agent only to a free workstation in a real room', () => {
    const rooms = new Map<string, Room>(building.floors.flatMap((floor) => floor.rooms.map((room) => [room.id, room])));
    const targetRoom = rooms.get('f3-engineering');
    expect(targetRoom).toBeTruthy();
    if (!targetRoom) return;
    const free = targetRoom.workstations.find(
      (ws) => !agents.some((agent) => agent.workstationId === ws.id),
    );
    expect(free).toBeTruthy();
    if (!free) return;

    const moved = moveAgent(baseState(), {
      agentId: 'agent-atlas',
      roomId: targetRoom.id,
      workstationId: free.id,
      at: '2026-10-25T10:00:00.000Z',
      rooms,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const agent = moved.state.agents.find((candidate) => candidate.id === 'agent-atlas');
    expect(agent?.roomId).toBe(targetRoom.id);
    expect(agent?.workstationId).toBe(free.id);

    const conflict = moveAgent(moved.state, {
      agentId: 'agent-vega',
      roomId: targetRoom.id,
      workstationId: free.id,
      at: '2026-10-25T10:05:00.000Z',
      rooms,
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.code).toBe('WORKSTATION_CONFLICT');
  });

  it('refuses to move a busy agent', () => {
    const rooms = new Map<string, Room>(building.floors.flatMap((floor) => floor.rooms.map((room) => [room.id, room])));
    const targetRoom = rooms.get('f3-api');
    const station = targetRoom?.workstations[1];
    if (!targetRoom || !station) return;
    const result = moveAgent(baseState(), {
      agentId: 'agent-relay',
      roomId: targetRoom.id,
      workstationId: station.id,
      at: '2026-10-25T10:00:00.000Z',
      rooms,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AGENT_BUSY');
  });
});

describe('derived agent status', () => {
  it('follows the task the agent holds', () => {
    const agent = fixtureAgent('agent-atria');
    const task = fixtureTask('task-run-001');
    expect(derivedAgentStatus(agent, [task])).toBe('WORKING');
    expect(derivedAgentStatus(agent, [{ ...task, status: 'WAITING' }])).toBe('WAITING');
    expect(derivedAgentStatus(agent, [{ ...task, status: 'FAILED' }])).toBe('ERROR');
  });

  it('keeps offline agents offline regardless of tasks', () => {
    const agent = fixtureAgent('agent-sentinel');
    expect(derivedAgentStatus(agent, [])).toBe('OFFLINE');
  });
});
