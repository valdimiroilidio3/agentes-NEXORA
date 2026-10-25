/**
 * Demo execution adapter.
 *
 * It performs NO external work. It waits, reports a few progress steps and
 * returns a deterministically seeded outcome so the operational layer can be
 * exercised end to end. Every result is flagged `simulated: true` and carries
 * the source `demo-adapter`, which the UI surfaces verbatim.
 */
import type { ExecutionOutcome, ExecutionPort, ExecutionRequest } from '@/domain/types';

export interface DemoPortOptions {
  readonly minDurationMs?: number;
  readonly maxDurationMs?: number;
  /** 0 = never fail, 1 = always fail. Seeded per task id. */
  readonly failureRate?: number;
  readonly seed?: number;
  /** Injectable timer so tests run instantly. */
  readonly wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultWait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

function hash(input: string): number {
  let h = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    h ^= input.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createDemoExecutionPort(options: DemoPortOptions = {}): ExecutionPort {
  const min = options.minDurationMs ?? 2600;
  const max = options.maxDurationMs ?? 5200;
  const failureRate = options.failureRate ?? 0.18;
  const seed = options.seed ?? 7;
  const wait = options.wait ?? defaultWait;

  return {
    mode: 'simulated',
    label: 'Demo adapter (simulated)',
    async execute({ task, agent, signal, onProgress }: ExecutionRequest): Promise<ExecutionOutcome> {
      const timeHash = hash(`${seed}:time:${task.id}`);
      const outcomeHash = hash(`${seed}:outcome:${task.id}`);
      const duration = min + (timeHash % Math.max(1, max - min));

      const steps = [
        'Reading the task brief…',
        `Preparing workspace in ${agent.roomId}…`,
        'Producing a simulated artefact…',
      ];
      const stepDelay = Math.max(1, Math.floor(duration / (steps.length + 1)));

      for (let index = 0; index < steps.length; index += 1) {
        await wait(stepDelay, signal);
        onProgress?.(steps[index] ?? 'Working…');
      }
      await wait(stepDelay, signal);

      const shouldFail = (outcomeHash % 1000) / 1000 < failureRate;
      if (shouldFail) {
        return {
          ok: false,
          summary: 'Simulated failure for demonstration purposes.',
          simulated: true,
          source: 'demo-adapter',
          error: {
            code: 'SIMULATED_FAILURE',
            message:
              'The demo adapter injected a failure so the failure path can be exercised. No external work was attempted.',
            retryable: true,
          },
        };
      }

      return {
        ok: true,
        summary: `Simulated run for "${task.title}" completed in ${(duration / 1000).toFixed(1)}s. No external system was contacted.`,
        simulated: true,
        source: 'demo-adapter',
        metrics: {
          durationMs: duration,
          steps: steps.length,
          seed,
        },
        artifacts: [`simulated/${task.id}.md`],
      };
    },
  };
}
