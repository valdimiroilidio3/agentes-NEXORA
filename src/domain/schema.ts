/**
 * Runtime validation for every JSON fixture that feeds the application.
 *
 * Fixtures are authored by hand, so they are validated at load time and in
 * the test suite. A malformed fixture must surface a readable error instead
 * of producing a partially rendered building.
 */
import { z } from 'zod';
import type { Agent, BuildingConfig, Task } from './types';

export const departmentIds = [
  'reception-command',
  'marketing',
  'sales',
  'technology',
  'management',
] as const;

export const roomTemplateIds = [
  'reception',
  'operations-center',
  'open-workspace',
  'private-office',
  'executive-office',
  'meeting-room',
  'creative-studio',
  'lab',
  'lounge',
  'core',
  'security',
] as const;

export const roomPurposes = [
  'reception',
  'command',
  'research',
  'content',
  'design',
  'campaigns',
  'prospecting',
  'proposals',
  'client-relations',
  'meeting',
  'engineering',
  'quality',
  'integration',
  'infrastructure',
  'executive',
  'finance',
  'delivery',
  'knowledge',
  'security',
  'hospitality',
  'circulation',
  'board',
] as const;

export const agentStatuses = ['IDLE', 'WORKING', 'WAITING', 'ERROR', 'OFFLINE'] as const;
export const taskStatuses = ['QUEUED', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED'] as const;
export const accentTokens = ['cyan', 'violet', 'amber', 'lime', 'rose', 'slate'] as const;
export const taskPriorities = ['low', 'normal', 'high'] as const;

const finite = z.number().finite();
const positive = z.number().finite().positive();
const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime());

export const rectSchema = z.object({
  x: finite,
  z: finite,
  width: positive,
  depth: positive,
});

export const doorSchema = z.object({
  edge: z.enum(['north', 'south', 'east', 'west']),
  offset: finite,
  width: positive,
});

export const roomConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  code: z.string().min(1),
  template: z.enum(roomTemplateIds),
  purpose: z.enum(roomPurposes),
  rect: rectSchema,
  ceilingHeight: positive.optional(),
  door: doorSchema,
  capacity: z.number().int().positive().optional(),
});

export const floorConfigSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(0),
  name: z.string().min(1),
  department: z.enum(departmentIds),
  ceilingHeight: positive,
  rooms: z.array(roomConfigSchema).min(1),
});

export const buildingConfigSchema = z.object({
  building: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    footprint: z.object({ width: positive, depth: positive }),
    floorHeight: positive,
    slabThickness: positive,
    corridorDepth: positive,
    interiorWallThickness: positive,
    exteriorWallThickness: positive,
  }),
  floors: z.array(floorConfigSchema).min(1),
});

export const agentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  specialization: z.string().min(1),
  department: z.enum(departmentIds),
  roomId: z.string().min(1),
  workstationId: z.string().min(1),
  status: z.enum(agentStatuses),
  currentTaskId: z.string().nullable(),
  lastActivityAt: isoDate,
  accent: z.enum(accentTokens),
  execution: z
    .object({
      provider: z.string().min(1),
      model: z.string().min(1).optional(),
      lastRunId: z.string().min(1).optional(),
    })
    .optional(),
});

export const taskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  status: z.enum(taskStatuses),
  agentId: z.string().min(1).nullable(),
  roomId: z.string().min(1),
  department: z.enum(departmentIds),
  priority: z.enum(taskPriorities),
  createdAt: isoDate,
  updatedAt: isoDate,
  startedAt: isoDate.nullable(),
  completedAt: isoDate.nullable(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      retryable: z.boolean(),
    })
    .nullable(),
  result: z
    .object({
      summary: z.string().min(1),
      simulated: z.boolean(),
      source: z.string().min(1),
      metrics: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      artifacts: z.array(z.string()).optional(),
    })
    .nullable(),
  dependsOn: z.array(z.string()).default([]),
});

export const agentsFileSchema = z.object({ agents: z.array(agentSchema).min(1) });
export const tasksFileSchema = z.object({ tasks: z.array(taskSchema).min(1) });

/* ------------------------------------------------------------------ */
/* Parse helpers                                                       */
/* ------------------------------------------------------------------ */

export class FixtureValidationError extends Error {
  constructor(
    readonly fixture: string,
    readonly issues: string[],
  ) {
    super(`Invalid ${fixture} fixture:\n- ${issues.join('\n- ')}`);
    this.name = 'FixtureValidationError';
  }
}

function parseWith<T>(fixture: string, schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new FixtureValidationError(fixture, issues);
  }
  return result.data;
}

export function parseBuildingConfig(input: unknown): BuildingConfig {
  return parseWith('building', buildingConfigSchema, input) as BuildingConfig;
}

export function parseAgents(input: unknown): Agent[] {
  return parseWith('agents', agentsFileSchema, input).agents as Agent[];
}

export function parseTasks(input: unknown): Task[] {
  return parseWith('tasks', tasksFileSchema, input).tasks as Task[];
}

export type { z };
