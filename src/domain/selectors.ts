/**
 * Derived read models. Everything the UI and scene display is computed here
 * from the spatial model + operational state, so there is a single source of
 * truth and no component mutates presentation state by hand.
 */
import type {
  Agent,
  AgentStatus,
  Building,
  DepartmentId,
  OperationalEvent,
  Room,
  Task,
  TaskStatus,
} from './types';
import type { OperationsState } from './operations';

export const DEPARTMENTS: Readonly<Record<DepartmentId, { label: string; short: string }>> = {
  'reception-command': { label: 'Reception & Command', short: 'Command' },
  marketing: { label: 'Marketing & Creative', short: 'Marketing' },
  sales: { label: 'Sales & Clients', short: 'Sales' },
  technology: { label: 'Technology', short: 'Technology' },
  management: { label: 'Management & Operations', short: 'Management' },
};

export const STATUS_TONE: Readonly<Record<AgentStatus, 'neutral' | 'active' | 'waiting' | 'error' | 'offline'>> = {
  IDLE: 'neutral',
  WORKING: 'active',
  WAITING: 'waiting',
  ERROR: 'error',
  OFFLINE: 'offline',
};

export interface RoomSummary {
  readonly roomId: string;
  readonly agents: readonly Agent[];
  readonly activeTaskCount: number;
  readonly queuedTaskCount: number;
  readonly completedTaskCount: number;
  readonly failedTaskCount: number;
  readonly workingAgents: number;
  readonly waitingAgents: number;
  readonly errorAgents: number;
  readonly idleAgents: number;
  readonly offlineAgents: number;
  readonly hasError: boolean;
  readonly hasActivity: boolean;
}

export function agentsInRoom(agents: readonly Agent[], roomId: string): Agent[] {
  return agents.filter((agent) => agent.roomId === roomId);
}

export function tasksInRoom(tasks: readonly Task[], roomId: string): Task[] {
  return tasks.filter((task) => task.roomId === roomId);
}

export function summariseRoom(state: OperationsState, roomId: string): RoomSummary {
  const agents = agentsInRoom(state.agents, roomId);
  const tasks = tasksInRoom(state.tasks, roomId);
  const count = (status: AgentStatus) => agents.filter((agent) => agent.status === status).length;
  return {
    roomId,
    agents,
    activeTaskCount: tasks.filter((task) => task.status === 'RUNNING').length,
    queuedTaskCount: tasks.filter((task) => task.status === 'QUEUED').length,
    completedTaskCount: tasks.filter((task) => task.status === 'COMPLETED').length,
    failedTaskCount: tasks.filter((task) => task.status === 'FAILED').length,
    workingAgents: count('WORKING'),
    waitingAgents: count('WAITING'),
    errorAgents: count('ERROR'),
    idleAgents: count('IDLE'),
    offlineAgents: count('OFFLINE'),
    hasError: count('ERROR') > 0 || tasks.some((task) => task.status === 'FAILED'),
    hasActivity: count('WORKING') > 0 || tasks.some((task) => task.status === 'RUNNING'),
  };
}

export interface FloorSummary {
  readonly floorId: string;
  readonly workingAgents: number;
  readonly totalAgents: number;
  readonly activeTasks: number;
  readonly failedTasks: number;
  readonly hasError: boolean;
  readonly hasActivity: boolean;
}

export function summariseFloor(building: Building, state: OperationsState, floorId: string): FloorSummary {
  const floor = building.floors.find((candidate) => candidate.id === floorId);
  const roomIds = new Set(floor?.rooms.map((room) => room.id) ?? []);
  const agents = state.agents.filter((agent) => roomIds.has(agent.roomId));
  const tasks = state.tasks.filter((task) => roomIds.has(task.roomId));
  return {
    floorId,
    workingAgents: agents.filter((agent) => agent.status === 'WORKING').length,
    totalAgents: agents.length,
    activeTasks: tasks.filter((task) => task.status === 'RUNNING' || task.status === 'WAITING').length,
    failedTasks: tasks.filter((task) => task.status === 'FAILED').length,
    hasError: agents.some((agent) => agent.status === 'ERROR') || tasks.some((task) => task.status === 'FAILED'),
    hasActivity: agents.some((agent) => agent.status === 'WORKING'),
  };
}

export interface BuildingSummary {
  readonly agents: number;
  readonly working: number;
  readonly waiting: number;
  readonly errors: number;
  readonly offline: number;
  readonly tasksRunning: number;
  readonly tasksQueued: number;
  readonly tasksCompleted: number;
  readonly tasksFailed: number;
  readonly simulatedResults: number;
}

export function summariseBuilding(state: OperationsState): BuildingSummary {
  return {
    agents: state.agents.length,
    working: state.agents.filter((agent) => agent.status === 'WORKING').length,
    waiting: state.agents.filter((agent) => agent.status === 'WAITING').length,
    errors: state.agents.filter((agent) => agent.status === 'ERROR').length,
    offline: state.agents.filter((agent) => agent.status === 'OFFLINE').length,
    tasksRunning: state.tasks.filter((task) => task.status === 'RUNNING').length,
    tasksQueued: state.tasks.filter((task) => task.status === 'QUEUED').length,
    tasksCompleted: state.tasks.filter((task) => task.status === 'COMPLETED').length,
    tasksFailed: state.tasks.filter((task) => task.status === 'FAILED').length,
    simulatedResults: state.tasks.filter((task) => task.result?.simulated === true).length,
  };
}

export function eventsForAgent(events: readonly OperationalEvent[], agentId: string): OperationalEvent[] {
  return events.filter((event) => event.agentId === agentId);
}

export function eventsForTask(events: readonly OperationalEvent[], taskId: string): OperationalEvent[] {
  return events.filter((event) => event.taskId === taskId);
}

export function eventsForRoom(events: readonly OperationalEvent[], roomId: string): OperationalEvent[] {
  return events.filter((event) => event.roomId === roomId);
}

/* ------------------------------------------------------------------ */
/* Task filtering                                                      */
/* ------------------------------------------------------------------ */

export type TaskStatusFilter = 'ALL' | TaskStatus;

export interface TaskFilter {
  readonly status: TaskStatusFilter;
  readonly agentId: string | null;
  readonly roomId: string | null;
  readonly department: DepartmentId | null;
  readonly query: string;
}

export const EMPTY_TASK_FILTER: TaskFilter = {
  status: 'ALL',
  agentId: null,
  roomId: null,
  department: null,
  query: '',
};

export function filterTasks(tasks: readonly Task[], filter: TaskFilter): Task[] {
  const query = filter.query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (filter.status !== 'ALL' && task.status !== filter.status) return false;
    if (filter.agentId && task.agentId !== filter.agentId) return false;
    if (filter.roomId && task.roomId !== filter.roomId) return false;
    if (filter.department && task.department !== filter.department) return false;
    if (query) {
      const haystack = `${task.title} ${task.description} ${task.id}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export type SearchKind = 'room' | 'agent' | 'task' | 'floor' | 'department';

export interface SearchResult {
  readonly kind: SearchKind;
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly floorId: string | null;
  readonly roomId: string | null;
}

export function searchEverything(
  building: Building,
  agents: readonly Agent[],
  tasks: readonly Task[],
  rawQuery: string,
  limit = 14,
): SearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 1) return [];
  const results: SearchResult[] = [];

  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      const agentsHere = agentsInRoom(agents, room.id);
      const haystack =
        `${room.name} ${room.code} ${room.template} ${room.purpose} ${floor.name} ${DEPARTMENTS[floor.department].label} ${agentsHere
          .map((agent) => `${agent.name} ${agent.role}`)
          .join(' ')}`.toLowerCase();
      if (haystack.includes(query)) {
        results.push({
          kind: 'room',
          id: room.id,
          label: room.name,
          detail: `${floor.name} · ${room.code}`,
          floorId: floor.id,
          roomId: room.id,
        });
      }
    }
    if (floor.name.toLowerCase().includes(query) || DEPARTMENTS[floor.department].label.toLowerCase().includes(query)) {
      results.push({
        kind: 'floor',
        id: floor.id,
        label: floor.name,
        detail: DEPARTMENTS[floor.department].label,
        floorId: floor.id,
        roomId: null,
      });
    }
  }

  for (const agent of agents) {
    if (`${agent.name} ${agent.role} ${agent.specialization}`.toLowerCase().includes(query)) {
      results.push({
        kind: 'agent',
        id: agent.id,
        label: `${agent.name} — ${agent.role}`,
        detail: agent.status.toLowerCase(),
        floorId: roomFloorId(building, agent.roomId),
        roomId: agent.roomId,
      });
    }
  }

  for (const task of tasks) {
    if (`${task.title} ${task.description} ${task.status}`.toLowerCase().includes(query)) {
      results.push({
        kind: 'task',
        id: task.id,
        label: task.title,
        detail: `${task.status.toLowerCase()} · ${task.id}`,
        floorId: roomFloorId(building, task.roomId),
        roomId: task.roomId,
      });
    }
  }

  return results.slice(0, limit);
}

export function roomFloorId(building: Building, roomId: string): string | null {
  const floor = building.floors.find((candidate) => candidate.rooms.some((room) => room.id === roomId));
  return floor?.id ?? null;
}

export function roomById(building: Building, roomId: string | null): Room | null {
  if (!roomId) return null;
  for (const floor of building.floors) {
    const room = floor.rooms.find((candidate) => candidate.id === roomId);
    if (room) return room;
  }
  return null;
}

export function agentById(agents: readonly Agent[], agentId: string | null): Agent | null {
  if (!agentId) return null;
  return agents.find((agent) => agent.id === agentId) ?? null;
}

export function taskById(tasks: readonly Task[], taskId: string | null): Task | null {
  if (!taskId) return null;
  return tasks.find((task) => task.id === taskId) ?? null;
}
