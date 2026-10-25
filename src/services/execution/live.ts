/**
 * Live execution bridge.
 *
 * The browser only ever talks to this application's own API route. That route
 * holds any credentials server-side and forwards to a configured execution
 * service. When nothing is configured the adapter fails honestly instead of
 * pretending a run happened.
 */
import type { ExecutionOutcome, ExecutionPort, ExecutionRequest } from '@/domain/types';

export interface LivePortOptions {
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

interface BridgeResponse {
  ok?: boolean;
  summary?: string;
  simulated?: boolean;
  source?: string;
  metrics?: Record<string, string | number>;
  artifacts?: string[];
  error?: { code?: string; message?: string; retryable?: boolean };
  code?: string;
  message?: string;
}

export function createLiveExecutionPort(options: LivePortOptions = {}): ExecutionPort {
  const endpoint = options.endpoint ?? '/api/executions';
  const timeoutMs = options.timeoutMs ?? 25_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    mode: 'live',
    label: 'Live execution bridge',
    async execute({ task, agent, signal }: ExecutionRequest): Promise<ExecutionOutcome> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });

      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            taskId: task.id,
            agentId: agent.id,
            title: task.title,
          }),
          signal: controller.signal,
        });

        const body = (await response.json().catch(() => ({}))) as BridgeResponse;

        if (!response.ok) {
          return {
            ok: false,
            summary: 'Execution bridge rejected the run.',
            simulated: false,
            source: endpoint,
            error: {
              code: body.code ?? body.error?.code ?? `HTTP_${response.status}`,
              message:
                body.message ??
                body.error?.message ??
                'The execution bridge is unavailable. Configure NEXORA_EXECUTION_ENDPOINT to enable live runs.',
              retryable: response.status >= 500 || response.status === 501,
            },
          };
        }

        if (typeof body.ok !== 'boolean' || typeof body.summary !== 'string') {
          return {
            ok: false,
            summary: 'Malformed response from the execution bridge.',
            simulated: false,
            source: endpoint,
            error: {
              code: 'INVALID_RESPONSE',
              message: 'The execution bridge returned a payload that does not match the execution contract.',
              retryable: false,
            },
          };
        }

        return {
          ok: body.ok,
          summary: body.summary,
          simulated: body.simulated === true,
          source: body.source ?? endpoint,
          ...(body.metrics ? { metrics: body.metrics } : {}),
          ...(body.artifacts ? { artifacts: body.artifacts } : {}),
          ...(body.ok
            ? {}
            : {
                error: {
                  code: body.error?.code ?? 'EXECUTION_FAILED',
                  message: body.error?.message ?? body.summary,
                  retryable: body.error?.retryable ?? true,
                },
              }),
        };
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        return {
          ok: false,
          summary: aborted ? 'Execution bridge timed out.' : 'Execution bridge unreachable.',
          simulated: false,
          source: endpoint,
          error: {
            code: aborted ? 'BRIDGE_TIMEOUT' : 'BRIDGE_UNREACHABLE',
            message: aborted
              ? `No response from the execution bridge within ${timeoutMs / 1000}s.`
              : 'The execution bridge could not be reached. This is expected until a live backend is configured.',
            retryable: true,
          },
        };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}
