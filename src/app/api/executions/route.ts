/**
 * Execution bridge (server side).
 *
 * The browser never receives the upstream URL or token. With no
 * NEXORA_EXECUTION_ENDPOINT configured, POST returns 501 and the client shows
 * an explicit "integration unavailable" state rather than a fake success.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  taskId: z.string().min(1).max(120),
  agentId: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
});

const upstreamSchema = z.object({
  ok: z.boolean(),
  summary: z.string().min(1).max(2000),
  simulated: z.boolean().optional(),
  metrics: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  artifacts: z.array(z.string().max(300)).max(50).optional(),
  error: z
    .object({
      code: z.string().min(1).max(80),
      message: z.string().min(1).max(1000),
      retryable: z.boolean().optional(),
    })
    .optional(),
});

function isConfigured(): boolean {
  return Boolean(process.env.NEXORA_EXECUTION_ENDPOINT);
}

export function GET() {
  return NextResponse.json({
    mode: isConfigured() ? 'live' : 'unavailable',
    label: isConfigured() ? 'Live execution bridge' : 'No execution service configured',
    note: 'Set NEXORA_EXECUTION_ENDPOINT (server-side) to enable live agent execution.',
  });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 'INVALID_REQUEST',
        message: `Invalid execution request: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join('; ')}`,
      },
      { status: 400 },
    );
  }

  const endpoint = process.env.NEXORA_EXECUTION_ENDPOINT;
  if (!endpoint) {
    return NextResponse.json(
      {
        code: 'INTEGRATION_UNAVAILABLE',
        message:
          'No execution service is configured. Set NEXORA_EXECUTION_ENDPOINT on the server to enable live runs.',
      },
      { status: 501 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (process.env.NEXORA_EXECUTION_TOKEN) {
      headers.authorization = `Bearer ${process.env.NEXORA_EXECUTION_TOKEN}`;
    }

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(parsed.data),
      signal: controller.signal,
      cache: 'no-store',
    });

    const body = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return NextResponse.json(
        {
          code: `UPSTREAM_${upstream.status}`,
          message: 'The execution service rejected the request.',
        },
        { status: 502 },
      );
    }

    const validated = upstreamSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        {
          code: 'INVALID_RESPONSE',
          message: 'The execution service returned a payload outside the execution contract.',
        },
        { status: 502 },
      );
    }

    return NextResponse.json(validated.data);
  } catch {
    return NextResponse.json(
      {
        code: 'BRIDGE_UNREACHABLE',
        message: 'The execution service could not be reached.',
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
