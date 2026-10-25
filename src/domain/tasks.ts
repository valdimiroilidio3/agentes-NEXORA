/**
 * Task lifecycle.
 *
 * The state machine is explicit and total: every transition that is not
 * listed as allowed is rejected. The UI never sets a status directly; it
 * calls a transition function, which also guarantees that agent state and
 * event history stay consistent with the task.
 */
import type { Task, TaskStatus } from './types';

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  QUEUED: ['RUNNING', 'FAILED'],
  RUNNING: ['COMPLETED', 'FAILED', 'WAITING'],
  WAITING: ['RUNNING', 'FAILED'],
  COMPLETED: [],
  FAILED: ['QUEUED'],
};

export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  WAITING: 'Waiting',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED';
}

export function isActiveStatus(status: TaskStatus): boolean {
  return status === 'RUNNING' || status === 'WAITING';
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly taskId: string,
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Task "${taskId}" cannot move from ${from} to ${to}.`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(task: Task, to: TaskStatus): void {
  if (!canTransition(task.status, to)) {
    throw new InvalidTransitionError(task.id, task.status, to);
  }
}

/** A task may only start once every dependency has completed successfully. */
export function unmetDependencies(task: Task, tasks: readonly Task[]): string[] {
  return task.dependsOn.filter((id) => {
    const dependency = tasks.find((candidate) => candidate.id === id);
    return !dependency || dependency.status !== 'COMPLETED';
  });
}

export function isTaskReady(task: Task, tasks: readonly Task[]): boolean {
  if (task.status !== 'QUEUED') return false;
  if (!task.agentId) return false;
  return unmetDependencies(task, tasks).length === 0;
}

/** Tasks in a runnable state for an agent that is currently free. */
export function nextRunnableTask(task: Task): boolean {
  return task.status === 'QUEUED' || task.status === 'WAITING';
}

export interface TaskTransitionPatch {
  readonly status: TaskStatus;
  readonly at: string;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly error?: Task['error'];
  readonly result?: Task['result'];
}

/** Pure transition: returns a new task with the timestamps kept coherent. */
export function applyTransition(task: Task, patch: TaskTransitionPatch): Task {
  assertTransition(task, patch.status);
  const startedAt =
    patch.startedAt !== undefined
      ? patch.startedAt
      : patch.status === 'RUNNING' && !task.startedAt
        ? patch.at
        : task.startedAt;
  const completedAt =
    patch.completedAt !== undefined
      ? patch.completedAt
      : patch.status === 'COMPLETED' || patch.status === 'FAILED'
        ? patch.at
        : null;

  return {
    ...task,
    status: patch.status,
    startedAt,
    completedAt,
    updatedAt: patch.at,
    error: patch.error !== undefined ? patch.error : patch.status === 'QUEUED' ? null : task.error,
    result: patch.result !== undefined ? patch.result : patch.status === 'QUEUED' ? null : task.result,
  };
}
