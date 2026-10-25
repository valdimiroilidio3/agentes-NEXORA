/**
 * Operational engine.
 *
 * A pure reducer over tasks, agents and the event log. Every mutation goes
 * through a named operation that validates its preconditions, keeps agent
 * state synchronised with the task it holds, and appends an audit event.
 *
 * Nothing here touches React, the store, the network or the 3D scene.
 */
import type {
  Agent,
  AgentStatus,
  OperationalEvent,
  OperationalEventType,
  Room,
  Task,
  TaskError,
  TaskResult,
} from './types';
import { canTransition, unmetDependencies } from './tasks';

export interface OperationsState {
  readonly tasks: readonly Task[];
  readonly agents: readonly Agent[];
  readonly events: readonly OperationalEvent[];
  readonly eventSeq: number;
}

export type OpsResult =
  | { readonly ok: true; readonly state: OperationsState; readonly event: OperationalEvent }
  | { readonly ok: false; readonly code: string; readonly message: string };

const MAX_EVENTS = 300;

export function createOperationsState(
  tasks: readonly Task[],
  agents: readonly Agent[],
  events: readonly OperationalEvent[] = [],
): OperationsState {
  return { tasks, agents, events, eventSeq: events.length };
}

function fail(code: string, message: string): OpsResult {
  return { ok: false, code, message };
}

interface EventInput {
  readonly type: OperationalEventType;
  readonly at: string;
  readonly level: OperationalEvent['level'];
  readonly message: string;
  readonly actor: OperationalEvent['actor'];
  readonly agentId?: string;
  readonly taskId?: string;
  readonly roomId?: string;
  readonly data?: OperationalEvent['data'];
}

function withEvent(state: OperationsState, input: EventInput): { state: OperationsState; event: OperationalEvent } {
  const seq = state.eventSeq + 1;
  const event: OperationalEvent = {
    id: `evt-${String(seq).padStart(4, '0')}`,
    ...input,
  };
  const events = [...state.events, event].slice(-MAX_EVENTS);
  return { state: { ...state, events, eventSeq: seq }, event };
}

function patchAgent(agents: readonly Agent[], agentId: string, patch: Partial<Agent>): readonly Agent[] {
  return agents.map((agent) => (agent.id === agentId ? { ...agent, ...patch } : agent));
}

function replaceTask(tasks: readonly Task[], task: Task): readonly Task[] {
  return tasks.map((candidate) => (candidate.id === task.id ? task : candidate));
}

function findTask(state: OperationsState, taskId: string): Task | undefined {
  return state.tasks.find((task) => task.id === taskId);
}

function findAgent(state: OperationsState, agentId: string): Agent | undefined {
  return state.agents.find((agent) => agent.id === agentId);
}

/* ------------------------------------------------------------------ */
/* Task operations                                                     */
/* ------------------------------------------------------------------ */

export interface StartOptions {
  readonly taskId: string;
  readonly at: string;
  /** True when the demo adapter drives the run. */
  readonly simulated?: boolean;
}

export function startTask(state: OperationsState, options: StartOptions): OpsResult {
  const task = findTask(state, options.taskId);
  if (!task) return fail('TASK_NOT_FOUND', `Unknown task "${options.taskId}".`);
  if (!task.agentId) return fail('TASK_UNASSIGNED', `Task "${task.id}" has no assigned agent.`);
  if (!canTransition(task.status, 'RUNNING')) {
    return fail('INVALID_TRANSITION', `Task "${task.id}" is ${task.status} and cannot start.`);
  }

  const unmet = unmetDependencies(task, state.tasks);
  if (unmet.length > 0) {
    return fail('DEPENDENCIES_UNMET', `Task "${task.id}" is blocked by: ${unmet.join(', ')}.`);
  }

  const agent = findAgent(state, task.agentId);
  if (!agent) return fail('AGENT_NOT_FOUND', `Task "${task.id}" points to a missing agent.`);
  if (agent.status === 'OFFLINE') return fail('AGENT_OFFLINE', `Agent "${agent.name}" is offline.`);
  if (agent.currentTaskId && agent.currentTaskId !== task.id) {
    return fail('AGENT_BUSY', `Agent "${agent.name}" is already running another task.`);
  }

  const now = options.at;
  const nextTask: Task = {
    ...task,
    status: 'RUNNING',
    startedAt: task.startedAt ?? now,
    completedAt: null,
    updatedAt: now,
    error: null,
    result: null,
  };
  const nextAgent: Agent = {
    ...agent,
    status: 'WORKING',
    currentTaskId: task.id,
    lastActivityAt: now,
  };

  const applied = withEvent(
    {
      ...state,
      tasks: replaceTask(state.tasks, nextTask),
      agents: patchAgent(state.agents, agent.id, nextAgent),
    },
    {
      type: 'TASK_STARTED',
      at: now,
      level: 'info',
      message: `${agent.name} started "${task.title}".`,
      actor: { kind: 'agent', id: agent.id },
      agentId: agent.id,
      taskId: task.id,
      roomId: task.roomId,
      data: { simulated: options.simulated ?? true },
    },
  );
  return { ok: true, ...applied };
}

export interface ProgressOptions {
  readonly taskId: string;
  readonly at: string;
  readonly message: string;
  readonly simulated: boolean;
}

/** Progress is informational: it never changes task or agent status. */
export function progressTask(state: OperationsState, options: ProgressOptions): OpsResult {
  const task = findTask(state, options.taskId);
  if (!task) return fail('TASK_NOT_FOUND', `Unknown task "${options.taskId}".`);
  if (task.status !== 'RUNNING') {
    return fail('INVALID_TRANSITION', `Task "${task.id}" is ${task.status}; progress ignored.`);
  }
  const applied = withEvent(
    {
      ...state,
      tasks: replaceTask(state.tasks, { ...task, updatedAt: options.at }),
    },
    {
      type: 'TASK_PROGRESS',
      at: options.at,
      level: 'info',
      message: options.message,
      actor: task.agentId
        ? { kind: 'agent', id: task.agentId }
        : { kind: 'system', id: 'engine' },
      ...(task.agentId ? { agentId: task.agentId } : {}),
      taskId: task.id,
      roomId: task.roomId,
      data: { simulated: options.simulated },
    },
  );
  return { ok: true, ...applied };
}

export interface EnqueueOptions {
  readonly task: Task;
}

export function enqueueTask(state: OperationsState, options: EnqueueOptions): OpsResult {
  const { task } = options;
  if (state.tasks.some((candidate) => candidate.id === task.id)) {
    return fail('DUPLICATE_TASK', `Task "${task.id}" already exists.`);
  }
  if (task.status !== 'QUEUED') {
    return fail('INVALID_TRANSITION', 'New tasks must be created in the QUEUED state.');
  }
  const applied = withEvent({ ...state, tasks: [...state.tasks, task] }, {
    type: 'TASK_QUEUED',
    at: task.createdAt,
    level: 'info',
    message: `"${task.title}" added to the queue.`,
    actor: { kind: 'system', id: 'engine' },
    ...(task.agentId ? { agentId: task.agentId } : {}),
    taskId: task.id,
    roomId: task.roomId,
  });
  return { ok: true, ...applied };
}

export interface CompleteOptions {
  readonly taskId: string;
  readonly at: string;
  readonly result: TaskResult;
}

export function completeTask(state: OperationsState, options: CompleteOptions): OpsResult {
  const task = findTask(state, options.taskId);
  if (!task) return fail('TASK_NOT_FOUND', `Unknown task "${options.taskId}".`);
  if (!canTransition(task.status, 'COMPLETED')) {
    return fail('INVALID_TRANSITION', `Task "${task.id}" is ${task.status} and cannot complete.`);
  }
  if (!options.result.simulated && options.result.source.trim().length === 0) {
    return fail('RESULT_UNVERIFIED', 'A live result must name its source.');
  }

  const now = options.at;
  const nextTask: Task = {
    ...task,
    status: 'COMPLETED',
    completedAt: now,
    updatedAt: now,
    result: options.result,
    error: null,
  };
  const agent = task.agentId ? findAgent(state, task.agentId) : undefined;
  const agents = agent
    ? patchAgent(state.agents, agent.id, {
        status: 'IDLE',
        currentTaskId: null,
        lastActivityAt: now,
      })
    : state.agents;

  const applied = withEvent(
    { ...state, tasks: replaceTask(state.tasks, nextTask), agents },
    {
      type: 'TASK_COMPLETED',
      at: now,
      level: 'success',
      message: `"${task.title}" completed: ${options.result.summary}`,
      actor: agent ? { kind: 'agent', id: agent.id } : { kind: 'system', id: 'engine' },
      ...(agent ? { agentId: agent.id } : {}),
      taskId: task.id,
      roomId: task.roomId,
      data: { simulated: options.result.simulated, source: options.result.source },
    },
  );
  return { ok: true, ...applied };
}

export interface FailOptions {
  readonly taskId: string;
  readonly at: string;
  readonly error: TaskError;
}

export function failTask(state: OperationsState, options: FailOptions): OpsResult {
  const task = findTask(state, options.taskId);
  if (!task) return fail('TASK_NOT_FOUND', `Unknown task "${options.taskId}".`);
  if (!canTransition(task.status, 'FAILED')) {
    return fail('INVALID_TRANSITION', `Task "${task.id}" is ${task.status} and cannot fail.`);
  }

  const now = options.at;
  const nextTask: Task = {
    ...task,
    status: 'FAILED',
    completedAt: now,
    updatedAt: now,
    error: options.error,
    result: null,
  };
  const agent = task.agentId ? findAgent(state, task.agentId) : undefined;
  const agents = agent
    ? patchAgent(state.agents, agent.id, {
        status: 'ERROR',
        currentTaskId: null,
        lastActivityAt: now,
      })
    : state.agents;

  const applied = withEvent(
    { ...state, tasks: replaceTask(state.tasks, nextTask), agents },
    {
      type: 'TASK_FAILED',
      at: now,
      level: 'error',
      message: `"${task.title}" failed (${options.error.code}): ${options.error.message}`,
      actor: agent ? { kind: 'agent', id: agent.id } : { kind: 'system', id: 'engine' },
      ...(agent ? { agentId: agent.id } : {}),
      taskId: task.id,
      roomId: task.roomId,
  data: { retryable: options.error.retryable },
    },
  );
  return { ok: true, ...applied };
}

export interface WaitOptions {
  readonly taskId: string;
  readonly at: string;
  readonly reason: string;
}

export function waitTask(state: OperationsState, options: WaitOptions): OpsResult {
  const task = findTask(state, options.taskId);
  if (!task) return fail('TASK_NOT_FOUND', `Unknown task "${options.taskId}".`);
  if (!canTransition(task.status, 'WAITING')) {
    return fail('INVALID_TRANSITION', `Task "${task.id}" is ${task.status} and cannot wait.`);
  }
  const now = options.at;
  const nextTask: Task = { ...task, status: 'WAITING', updatedAt: now };
  const agent = task.agentId ? findAgent(state, task.agentId) : undefined;
  const agents = agent
    ? patchAgent(state.agents, agent.id, {
        status: 'WAITING',
        currentTaskId: task.id,
        lastActivityAt: now,
      })
    : state.agents;

  const applied = withEvent({ ...state, tasks: replaceTask(state.tasks, nextTask), agents }, {
    type: 'TASK_PROGRESS',
    at: now,
    level: 'warning',
    message: `"${task.title}" is waiting: ${options.reason}`,
    actor: agent ? { kind: 'agent', id: agent.id } : { kind: 'system', id: 'engine' },
    ...(agent ? { agentId: agent.id } : {}),
    taskId: task.id,
    roomId: task.roomId,
  });
  return { ok: true, ...applied };
}

export interface RetryOptions {
  readonly taskId: string;
  readonly at: string;
}

export function retryTask(state: OperationsState, options: RetryOptions): OpsResult {
  const task = findTask(state, options.taskId);
  if (!task) return fail('TASK_NOT_FOUND', `Unknown task "${options.taskId}".`);
  if (task.status !== 'FAILED') {
    return fail('INVALID_TRANSITION', `Only failed tasks can be retried ("${task.id}" is ${task.status}).`);
  }
  if (task.error && !task.error.retryable) {
    return fail('NOT_RETRYABLE', `"${task.title}" is not retryable (${task.error.code}).`);
  }

  const now = options.at;
  const nextTask: Task = {
    ...task,
    status: 'QUEUED',
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    error: null,
    result: null,
  };
  const agent = task.agentId ? findAgent(state, task.agentId) : undefined;
  const agents = agent
    ? patchAgent(state.agents, agent.id, {
        status: agent.currentTaskId ? agent.status : 'IDLE',
        lastActivityAt: now,
      })
    : state.agents;

  const applied = withEvent({ ...state, tasks: replaceTask(state.tasks, nextTask), agents }, {
    type: 'TASK_RETRY_SCHEDULED',
    at: now,
    level: 'warning',
    message: `"${task.title}" was re-queued for retry.`,
    actor: { kind: 'user', id: 'operator' },
    ...(agent ? { agentId: agent.id } : {}),
    taskId: task.id,
    roomId: task.roomId,
  });
  return { ok: true, ...applied };
}

export function cancelTask(state: OperationsState, options: RetryOptions): OpsResult {
  const task = findTask(state, options.taskId);
  if (!task) return fail('TASK_NOT_FOUND', `Unknown task "${options.taskId}".`);
  if (!canTransition(task.status, 'FAILED')) {
    return fail('INVALID_TRANSITION', `Task "${task.id}" is ${task.status} and cannot be cancelled.`);
  }
  const now = options.at;
  const nextTask: Task = {
    ...task,
    status: 'FAILED',
    completedAt: now,
    updatedAt: now,
    error: { code: 'CANCELLED', message: 'Cancelled by operator.', retryable: true },
    result: null,
  };
  const agent = task.agentId ? findAgent(state, task.agentId) : undefined;
  const agents = agent
    ? patchAgent(state.agents, agent.id, {
        status: 'IDLE',
        currentTaskId: null,
        lastActivityAt: now,
      })
    : state.agents;

  const applied = withEvent({ ...state, tasks: replaceTask(state.tasks, nextTask), agents }, {
    type: 'TASK_CANCELLED',
    at: now,
    level: 'warning',
    message: `"${task.title}" was cancelled.`,
    actor: { kind: 'user', id: 'operator' },
    ...(agent ? { agentId: agent.id } : {}),
    taskId: task.id,
    roomId: task.roomId,
  });
  return { ok: true, ...applied };
}

export interface AssignOptions {
  readonly taskId: string;
  readonly agentId: string;
  readonly at: string;
}

/** Explicit re-assignment: the task moves to the new agent's room as well. */
export function assignTask(state: OperationsState, options: AssignOptions): OpsResult {
  const task = findTask(state, options.taskId);
  if (!task) return fail('TASK_NOT_FOUND', `Unknown task "${options.taskId}".`);
  if (task.status !== 'QUEUED') {
    return fail('INVALID_TRANSITION', `Only queued tasks can be re-assigned ("${task.id}" is ${task.status}).`);
  }
  const agent = findAgent(state, options.agentId);
  if (!agent) return fail('AGENT_NOT_FOUND', `Unknown agent "${options.agentId}".`);
  if (agent.status === 'OFFLINE') return fail('AGENT_OFFLINE', `Agent "${agent.name}" is offline.`);

  const now = options.at;
  const nextTask: Task = {
    ...task,
    agentId: agent.id,
    roomId: agent.roomId,
    department: agent.department,
    updatedAt: now,
  };
  const applied = withEvent({ ...state, tasks: replaceTask(state.tasks, nextTask) }, {
    type: 'AGENT_REASSIGNED',
    at: now,
    level: 'info',
    message: `"${task.title}" re-assigned to ${agent.name}.`,
    actor: { kind: 'user', id: 'operator' },
    agentId: agent.id,
    taskId: task.id,
    roomId: agent.roomId,
  });
  return { ok: true, ...applied };
}

/* ------------------------------------------------------------------ */
/* Agent operations                                                    */
/* ------------------------------------------------------------------ */

export interface AgentStatusOptions {
  readonly agentId: string;
  readonly status: AgentStatus;
  readonly at: string;
  readonly reason?: string;
}

/** Only offline/idle toggles are operator-driven; working states come from tasks. */
export function setAgentStatus(state: OperationsState, options: AgentStatusOptions): OpsResult {
  const agent = findAgent(state, options.agentId);
  if (!agent) return fail('AGENT_NOT_FOUND', `Unknown agent "${options.agentId}".`);
  const allowed: AgentStatus[] = ['OFFLINE', 'IDLE', 'ERROR'];
  if (!allowed.includes(options.status)) {
    return fail('INVALID_AGENT_STATUS', `Status ${options.status} is derived from task execution.`);
  }
  if (options.status === 'OFFLINE' && agent.currentTaskId) {
    return fail('AGENT_BUSY', `Cannot take "${agent.name}" offline while a task is active.`);
  }
  if (options.status === 'IDLE' && agent.currentTaskId) {
    return fail('AGENT_BUSY', `Cannot clear a task through a status update.`);
  }

  const agents = patchAgent(state.agents, agent.id, {
    status: options.status,
    lastActivityAt: options.at,
  });
  const applied = withEvent({ ...state, agents }, {
    type: 'AGENT_STATUS_CHANGED',
    at: options.at,
    level: options.status === 'ERROR' ? 'error' : 'info',
    message: options.reason ?? `${agent.name} is now ${options.status.toLowerCase()}.`,
    actor: { kind: 'user', id: 'operator' },
    agentId: agent.id,
    roomId: agent.roomId,
  });
  return { ok: true, ...applied };
}

export interface MoveAgentOptions {
  readonly agentId: string;
  readonly roomId: string;
  readonly workstationId: string;
  readonly at: string;
  readonly rooms: ReadonlyMap<string, Room>;
}

/**
 * The only way an agent changes room. Spatial assignment and the rendered
 * position can therefore never diverge.
 */
export function moveAgent(state: OperationsState, options: MoveAgentOptions): OpsResult {
  const agent = findAgent(state, options.agentId);
  if (!agent) return fail('AGENT_NOT_FOUND', `Unknown agent "${options.agentId}".`);
  const room = options.rooms.get(options.roomId);
  if (!room) return fail('ROOM_NOT_FOUND', `Unknown room "${options.roomId}".`);
  const workstation = room.workstations.find((ws) => ws.id === options.workstationId);
  if (!workstation) {
    return fail('WORKSTATION_NOT_FOUND', `Room "${room.name}" has no workstation "${options.workstationId}".`);
  }
  if (agent.currentTaskId) {
    return fail('AGENT_BUSY', `Cannot move "${agent.name}" while a task is active.`);
  }
  const occupied = state.agents.find(
    (other) => other.id !== agent.id && other.workstationId === workstation.id,
  );
  if (occupied) {
    return fail('WORKSTATION_CONFLICT', `Workstation is already used by ${occupied.name}.`);
  }

  const agents = patchAgent(state.agents, agent.id, {
    roomId: room.id,
    workstationId: workstation.id,
    lastActivityAt: options.at,
  });
  const applied = withEvent({ ...state, agents }, {
    type: 'AGENT_REASSIGNED',
    at: options.at,
    level: 'info',
    message: `${agent.name} moved to ${room.name}.`,
    actor: { kind: 'user', id: 'operator' },
    agentId: agent.id,
    roomId: room.id,
    data: { from: agent.roomId, to: room.id, workstationId: workstation.id },
  });
  return { ok: true, ...applied };
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function recordIntegrationIssue(
  state: OperationsState,
  at: string,
  message: string,
): OpsResult {
  const applied = withEvent(state, {
    type: 'INTEGRATION_UNAVAILABLE',
    at,
    level: 'warning',
    message,
    actor: { kind: 'system', id: 'integration' },
  });
  return { ok: true, ...applied };
}
