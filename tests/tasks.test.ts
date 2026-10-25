import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  applyTransition,
  canTransition,
  isTaskReady,
  unmetDependencies,
} from '@/domain/tasks';
import type { Task } from '@/domain/types';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Prepare report',
    description: 'Assemble the weekly report.',
    status: 'QUEUED',
    agentId: 'agent-1',
    roomId: 'room-1',
    department: 'technology',
    priority: 'normal',
    createdAt: '2026-10-25T08:00:00.000Z',
    updatedAt: '2026-10-25T08:00:00.000Z',
    startedAt: null,
    completedAt: null,
    error: null,
    result: null,
    dependsOn: [],
    ...overrides,
  };
}

describe('task state machine', () => {
  it('allows only the declared transitions', () => {
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'COMPLETED')).toBe(true);
    expect(canTransition('RUNNING', 'FAILED')).toBe(true);
    expect(canTransition('RUNNING', 'WAITING')).toBe(true);
    expect(canTransition('WAITING', 'RUNNING')).toBe(true);
    expect(canTransition('FAILED', 'QUEUED')).toBe(true);

    expect(canTransition('QUEUED', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false);
    expect(canTransition('FAILED', 'COMPLETED')).toBe(false);
    expect(canTransition('WAITING', 'COMPLETED')).toBe(false);
  });

  it('throws on an invalid transition', () => {
    const queued = task();
    expect(() => applyTransition(queued, { status: 'COMPLETED', at: '2026-10-25T09:00:00.000Z' })).toThrow(
      InvalidTransitionError,
    );
  });

  it('stamps timestamps coherently', () => {
    const queued = task();
    const running = applyTransition(queued, { status: 'RUNNING', at: '2026-10-25T09:00:00.000Z' });
    expect(running.startedAt).toBe('2026-10-25T09:00:00.000Z');
    expect(running.completedAt).toBeNull();

    const completed = applyTransition(running, {
      status: 'COMPLETED',
      at: '2026-10-25T09:05:00.000Z',
      result: { summary: 'done', simulated: true, source: 'demo-adapter' },
    });
    expect(completed.completedAt).toBe('2026-10-25T09:05:00.000Z');
    expect(completed.updatedAt).toBe('2026-10-25T09:05:00.000Z');
    expect(completed.result?.simulated).toBe(true);
  });

  it('clears stale errors and results when re-queued', () => {
    const failed = task({
      status: 'FAILED',
      error: { code: 'X', message: 'boom', retryable: true },
      completedAt: '2026-10-25T09:00:00.000Z',
    });
    const queued = applyTransition(failed, { status: 'QUEUED', at: '2026-10-25T09:10:00.000Z' });
    expect(queued.error).toBeNull();
    expect(queued.result).toBeNull();
    expect(queued.completedAt).toBeNull();
    expect(queued.startedAt).toBeNull();
  });
});

describe('dependencies', () => {
  const dependency = task({ id: 'task-0', status: 'RUNNING' });
  const dependent = task({ id: 'task-2', dependsOn: ['task-0'] });

  it('reports unmet dependencies', () => {
    expect(unmetDependencies(dependent, [dependency, dependent])).toEqual(['task-0']);
    expect(isTaskReady(dependent, [dependency, dependent])).toBe(false);
  });

  it('becomes ready once the dependency completes', () => {
    const done = { ...dependency, status: 'COMPLETED' as const };
    expect(unmetDependencies(dependent, [done, dependent])).toEqual([]);
    expect(isTaskReady(dependent, [done, dependent])).toBe(true);
  });

  it('treats a missing dependency as unmet', () => {
    expect(unmetDependencies(dependent, [dependent])).toEqual(['task-0']);
  });
});
