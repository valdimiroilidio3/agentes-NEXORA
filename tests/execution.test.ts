import { describe, expect, it, vi } from 'vitest';
import { createDemoExecutionPort } from '@/services/execution/demo';
import { createLiveExecutionPort } from '@/services/execution/live';
import type { Agent, Task } from '@/domain/types';

const task: Task = {
  id: 'task-demo-1',
  title: 'Demo run',
  description: 'Simulated work.',
  status: 'RUNNING',
  agentId: 'agent-1',
  roomId: 'room-1',
  department: 'technology',
  priority: 'normal',
  createdAt: '2026-10-25T08:00:00.000Z',
  updatedAt: '2026-10-25T08:00:00.000Z',
  startedAt: '2026-10-25T08:00:10.000Z',
  completedAt: null,
  error: null,
  result: null,
  dependsOn: [],
};

const agent: Agent = {
  id: 'agent-1',
  name: 'Tester',
  role: 'Test agent',
  specialization: 'Testing',
  department: 'technology',
  roomId: 'room-1',
  workstationId: 'room-1-ws1',
  status: 'WORKING',
  currentTaskId: task.id,
  lastActivityAt: '2026-10-25T08:00:10.000Z',
  accent: 'cyan',
};

const instant = async () => {};

describe('demo execution adapter', () => {
  it('is explicitly labelled as simulated', () => {
    const port = createDemoExecutionPort({ wait: instant });
    expect(port.mode).toBe('simulated');
    expect(port.label.toLowerCase()).toContain('simulated');
  });

  it('returns a successful, clearly simulated result when failureRate is 0', async () => {
    const port = createDemoExecutionPort({ wait: instant, failureRate: 0 });
    const progress: string[] = [];
    const outcome = await port.execute({ task, agent, onProgress: (message) => progress.push(message) });
    expect(outcome.ok).toBe(true);
    expect(outcome.simulated).toBe(true);
    expect(outcome.source).toBe('demo-adapter');
    expect(outcome.summary).toContain('Simulated');
    expect(outcome.metrics?.durationMs).toBeGreaterThan(0);
    expect(progress.length).toBeGreaterThan(0);
  });

  it('returns a retryable failure when failureRate is 1', async () => {
    const port = createDemoExecutionPort({ wait: instant, failureRate: 1 });
    const outcome = await port.execute({ task, agent });
    expect(outcome.ok).toBe(false);
    expect(outcome.simulated).toBe(true);
    expect(outcome.error?.code).toBe('SIMULATED_FAILURE');
    expect(outcome.error?.retryable).toBe(true);
  });

  it('is deterministic for the same task id and seed', async () => {
    const first = await createDemoExecutionPort({ wait: instant, failureRate: 0.5 }).execute({ task, agent });
    const second = await createDemoExecutionPort({ wait: instant, failureRate: 0.5 }).execute({ task, agent });
    expect(first.ok).toBe(second.ok);
    expect(first.metrics?.durationMs).toBe(second.metrics?.durationMs);
  });

  it('honours an abort signal', async () => {
    const port = createDemoExecutionPort({ minDurationMs: 50, maxDurationMs: 60 });
    const controller = new AbortController();
    const run = port.execute({ task, agent, signal: controller.signal });
    controller.abort();
    await expect(run).rejects.toThrow();
  });
});

describe('live execution bridge adapter', () => {
  it('reports an unavailable integration honestly', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 501,
      json: async () => ({
        code: 'INTEGRATION_UNAVAILABLE',
        message: 'No execution service is configured.',
      }),
    })) as unknown as typeof fetch;
    const port = createLiveExecutionPort({ fetchImpl });
    const outcome = await port.execute({ task, agent });
    expect(outcome.ok).toBe(false);
    expect(outcome.simulated).toBe(false);
    expect(outcome.error?.code).toBe('INTEGRATION_UNAVAILABLE');
    expect(outcome.error?.retryable).toBe(true);
    expect(outcome.summary).not.toMatch(/completed/i);
  });

  it('maps a valid upstream outcome', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        summary: 'External collector finished.',
        simulated: false,
        metrics: { rows: 12 },
        artifacts: ['report.json'],
      }),
    })) as unknown as typeof fetch;
    const port = createLiveExecutionPort({ fetchImpl });
    const outcome = await port.execute({ task, agent });
    expect(outcome.ok).toBe(true);
    expect(outcome.simulated).toBe(false);
    expect(outcome.metrics?.rows).toBe(12);
    expect(outcome.artifacts).toEqual(['report.json']);
  });

  it('rejects a malformed upstream payload instead of inventing success', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: 'nothing useful' }),
    })) as unknown as typeof fetch;
    const port = createLiveExecutionPort({ fetchImpl });
    const outcome = await port.execute({ task, agent });
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe('INVALID_RESPONSE');
  });

  it('reports an unreachable bridge', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const port = createLiveExecutionPort({ fetchImpl });
    const outcome = await port.execute({ task, agent });
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe('BRIDGE_UNREACHABLE');
  });
});
