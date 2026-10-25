import { describe, expect, it } from 'vitest';
import buildingFixture from '@/data/building.json';
import agentsFixture from '@/data/agents.json';
import tasksFixture from '@/data/tasks.json';
import { loadBuilding } from '@/domain/building';
import { parseAgents, parseTasks } from '@/domain/schema';
import { createOperationsState } from '@/domain/operations';
import {
  DEPARTMENTS,
  agentsInRoom,
  filterTasks,
  roomFloorId,
  searchEverything,
  summariseBuilding,
  summariseFloor,
  summariseRoom,
  tasksInRoom,
} from '@/domain/selectors';
import { EMPTY_TASK_FILTER } from '@/domain/selectors';

const { building } = loadBuilding(buildingFixture);
const agents = parseAgents(agentsFixture);
const tasks = parseTasks(tasksFixture);
const state = createOperationsState(tasks, agents);

describe('room and floor summaries', () => {
  it('counts agents and tasks per room', () => {
    const roomId = 'f3-engineering';
    const summary = summariseRoom(state, roomId);
    expect(summary.agents.length).toBe(agentsInRoom(agents, roomId).length);
    expect(summary.agents.length).toBe(3);
    expect(summary.queuedTaskCount).toBe(tasksInRoom(tasks, roomId).filter((task) => task.status === 'QUEUED').length);
    expect(summary.idleAgents).toBe(3);
    expect(summary.hasActivity).toBe(false);
  });

  it('flags rooms with a running agent', () => {
    const summary = summariseRoom(state, 'f2-leads');
    expect(summary.hasActivity).toBe(true);
    expect(summary.workingAgents).toBe(1);
  });

  it('flags rooms with failures', () => {
    const summary = summariseRoom(state, 'f4-delivery');
    expect(summary.hasError).toBe(true);
    expect(summary.failedTaskCount).toBe(1);
  });

  it('returns an empty summary for unknown rooms', () => {
    const summary = summariseRoom(state, 'nope');
    expect(summary.agents).toEqual([]);
    expect(summary.activeTaskCount).toBe(0);
  });

  it('aggregates floors and the building', () => {
    const floor3 = summariseFloor(building, state, 'floor-3');
    expect(floor3.totalAgents).toBeGreaterThan(0);
    expect(floor3.hasActivity).toBe(true);

    const summary = summariseBuilding(state);
    expect(summary.agents).toBe(agents.length);
    expect(summary.working).toBe(2);
    expect(summary.tasksRunning).toBe(2);
    expect(summary.tasksFailed).toBe(1);
    expect(summary.simulatedResults).toBe(3);
  });
});

describe('task filtering', () => {
  it('filters by status, agent, room, department and text', () => {
    expect(filterTasks(tasks, { ...EMPTY_TASK_FILTER, status: 'QUEUED' }).every((task) => task.status === 'QUEUED')).toBe(true);
    expect(filterTasks(tasks, { ...EMPTY_TASK_FILTER, agentId: 'agent-nova' }).every((task) => task.agentId === 'agent-nova')).toBe(true);
    expect(filterTasks(tasks, { ...EMPTY_TASK_FILTER, roomId: 'f3-qa' }).every((task) => task.roomId === 'f3-qa')).toBe(true);
    expect(
      filterTasks(tasks, { ...EMPTY_TASK_FILTER, department: 'marketing' }).every((task) => task.department === 'marketing'),
    ).toBe(true);
    expect(filterTasks(tasks, { ...EMPTY_TASK_FILTER, query: 'brand' }).length).toBeGreaterThan(0);
    expect(filterTasks(tasks, { ...EMPTY_TASK_FILTER, query: 'zzzz' })).toEqual([]);
  });
});

describe('search', () => {
  it('finds rooms, floors, agents and tasks', () => {
    expect(searchEverything(building, agents, tasks, 'board').some((result) => result.kind === 'room')).toBe(true);
    expect(searchEverything(building, agents, tasks, 'atlas').some((result) => result.kind === 'agent')).toBe(true);
    expect(searchEverything(building, agents, tasks, 'cluster').some((result) => result.kind === 'task')).toBe(true);
    expect(searchEverything(building, agents, tasks, 'marketing').some((result) => result.kind === 'floor')).toBe(true);
  });

  it('returns an empty list for an empty query', () => {
    expect(searchEverything(building, agents, tasks, '   ')).toEqual([]);
  });

  it('resolves the floor of a room', () => {
    expect(roomFloorId(building, 'f4-board')).toBe('floor-4');
    expect(roomFloorId(building, 'missing')).toBeNull();
  });

  it('labels every department', () => {
    expect(Object.keys(DEPARTMENTS)).toHaveLength(5);
    expect(DEPARTMENTS.technology.label).toContain('Technology');
  });
});
