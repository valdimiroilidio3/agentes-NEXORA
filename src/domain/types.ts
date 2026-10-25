/**
 * NEXORA OFFICE 3D — domain types.
 *
 * This module is environment-agnostic (no React, no Three.js) so that the
 * spatial model, the operational model and their invariants can be unit
 * tested without a browser.
 *
 * Units: metres, seconds-free ISO-8601 timestamps (UTC).
 * Coordinate system: +x east, +z south, +y up. "north" is -z.
 */

/* ------------------------------------------------------------------ */
/* Spatial primitives                                                  */
/* ------------------------------------------------------------------ */

/** Axis-aligned rectangle in the floor plane, defined by its centre. */
export interface Rect {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
}

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export type WallEdge = 'north' | 'south' | 'east' | 'west';

export interface DoorSpec {
  /** Wall the door is cut into. */
  readonly edge: WallEdge;
  /** Offset of the door centre from the room centre, along the edge axis. */
  readonly offset: number;
  readonly width: number;
}

/* ------------------------------------------------------------------ */
/* Rooms, floors, building                                             */
/* ------------------------------------------------------------------ */

export type DepartmentId =
  | 'reception-command'
  | 'marketing'
  | 'sales'
  | 'technology'
  | 'management';

export type RoomTemplateId =
  | 'reception'
  | 'operations-center'
  | 'open-workspace'
  | 'private-office'
  | 'executive-office'
  | 'meeting-room'
  | 'creative-studio'
  | 'lab'
  | 'lounge'
  | 'core'
  | 'security';

export type RoomPurpose =
  | 'reception'
  | 'command'
  | 'research'
  | 'content'
  | 'design'
  | 'campaigns'
  | 'prospecting'
  | 'proposals'
  | 'client-relations'
  | 'meeting'
  | 'engineering'
  | 'quality'
  | 'integration'
  | 'infrastructure'
  | 'executive'
  | 'finance'
  | 'delivery'
  | 'knowledge'
  | 'security'
  | 'hospitality'
  | 'circulation'
  | 'board';

export type FurnitureKind =
  | 'desk'
  | 'chair'
  | 'monitor'
  | 'shelf'
  | 'sofa'
  | 'coffee-table'
  | 'meeting-table'
  | 'whiteboard'
  | 'plant'
  | 'counter'
  | 'credenza'
  | 'server-rack'
  | 'bench'
  | 'stool'
  | 'video-wall'
  | 'elevator-door'
  | 'stair'
  | 'turnstile'
  | 'rug';

export interface FurniturePlacement {
  readonly id: string;
  readonly kind: FurnitureKind;
  readonly position: Vec2;
  readonly rotationY: number;
  readonly scale?: number;
}

export interface Workstation {
  readonly id: string;
  readonly roomId: string;
  readonly position: Vec2;
  readonly rotationY: number;
  /** World-space point an assigned agent occupies (seat anchor). */
  readonly seat: Vec2;
}

export interface Room {
  readonly id: string;
  readonly floorId: string;
  readonly name: string;
  readonly code: string;
  readonly template: RoomTemplateId;
  readonly purpose: RoomPurpose;
  readonly rect: Rect;
  readonly ceilingHeight: number;
  readonly door: DoorSpec;
  readonly capacity: number;
  /** Exterior walls of this room (facade walls get glazing). */
  readonly exteriorWalls: readonly WallEdge[];
  readonly furniture: readonly FurniturePlacement[];
  readonly workstations: readonly Workstation[];
}

export interface Floor {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly department: DepartmentId;
  /** Slab top / finished floor level in metres. */
  readonly elevation: number;
  readonly ceilingHeight: number;
  readonly footprint: { readonly width: number; readonly depth: number };
  readonly rooms: readonly Room[];
}

export interface Building {
  readonly id: string;
  readonly name: string;
  readonly footprint: { readonly width: number; readonly depth: number };
  readonly floorHeight: number;
  readonly slabThickness: number;
  readonly corridorDepth: number;
  readonly interiorWallThickness: number;
  readonly exteriorWallThickness: number;
  readonly floors: readonly Floor[];
}

/* ------------------------------------------------------------------ */
/* Configuration (JSON fixtures)                                       */
/* ------------------------------------------------------------------ */

export interface RoomConfig {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly template: RoomTemplateId;
  readonly purpose: RoomPurpose;
  readonly rect: Rect;
  readonly ceilingHeight?: number;
  readonly door: DoorSpec;
  readonly capacity?: number;
}

export interface FloorConfig {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly department: DepartmentId;
  readonly ceilingHeight: number;
  readonly rooms: readonly RoomConfig[];
}

export interface BuildingConfig {
  readonly building: {
    readonly id: string;
    readonly name: string;
    readonly footprint: { readonly width: number; readonly depth: number };
    readonly floorHeight: number;
    readonly slabThickness: number;
    readonly corridorDepth: number;
    readonly interiorWallThickness: number;
    readonly exteriorWallThickness: number;
  };
  readonly floors: readonly FloorConfig[];
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export type AgentStatus = 'IDLE' | 'WORKING' | 'WAITING' | 'ERROR' | 'OFFLINE';

export type AccentToken = 'cyan' | 'violet' | 'amber' | 'lime' | 'rose' | 'slate';

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly specialization: string;
  readonly department: DepartmentId;
  readonly roomId: string;
  readonly workstationId: string;
  readonly status: AgentStatus;
  readonly currentTaskId: string | null;
  readonly lastActivityAt: string;
  readonly accent: AccentToken;
  /** Optional metadata about the executor that would drive this agent. */
  readonly execution?: {
    readonly provider: string;
    readonly model?: string;
    readonly lastRunId?: string;
  };
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export type TaskStatus = 'QUEUED' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED';

export type TaskPriority = 'low' | 'normal' | 'high';

export interface TaskError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface TaskResult {
  readonly summary: string;
  /** True whenever the outcome comes from the local demo adapter. */
  readonly simulated: boolean;
  readonly source: string;
  readonly metrics?: Readonly<Record<string, string | number>>;
  readonly artifacts?: readonly string[];
}

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly agentId: string | null;
  readonly roomId: string;
  readonly department: DepartmentId;
  readonly priority: TaskPriority;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly error: TaskError | null;
  readonly result: TaskResult | null;
  readonly dependsOn: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Operational events                                                  */
/* ------------------------------------------------------------------ */

export type OperationalEventType =
  | 'TASK_QUEUED'
  | 'TASK_STARTED'
  | 'TASK_PROGRESS'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_RETRY_SCHEDULED'
  | 'TASK_CANCELLED'
  | 'AGENT_STATUS_CHANGED'
  | 'AGENT_REASSIGNED'
  | 'INTEGRATION_UNAVAILABLE'
  | 'DATA_LOADED';

export type EventLevel = 'info' | 'success' | 'warning' | 'error';

export interface OperationalEvent {
  readonly id: string;
  readonly type: OperationalEventType;
  readonly at: string;
  readonly level: EventLevel;
  readonly message: string;
  readonly actor: { readonly kind: 'agent' | 'system' | 'user'; readonly id: string };
  readonly agentId?: string;
  readonly taskId?: string;
  readonly roomId?: string;
  readonly data?: Readonly<Record<string, string | number | boolean>>;
}

/* ------------------------------------------------------------------ */
/* Execution port (real backends plug in behind this interface)        */
/* ------------------------------------------------------------------ */

export type ExecutionMode = 'simulated' | 'live';

export interface ExecutionRequest {
  readonly task: Task;
  readonly agent: Agent;
  readonly signal?: AbortSignal;
  /** Adapters may report intermediate steps; these never change status. */
  readonly onProgress?: (message: string) => void;
}

export interface ExecutionOutcome {
  readonly ok: boolean;
  readonly summary: string;
  readonly simulated: boolean;
  readonly source: string;
  readonly metrics?: Readonly<Record<string, string | number>>;
  readonly artifacts?: readonly string[];
  readonly error?: TaskError;
}

/**
 * The only contract the operational layer knows about. Implemented by the
 * local demo adapter today, and by a server-backed adapter later without
 * touching the 3D scene or the task state machine.
 */
export interface ExecutionPort {
  readonly mode: ExecutionMode;
  readonly label: string;
  execute(request: ExecutionRequest): Promise<ExecutionOutcome>;
}

/* ------------------------------------------------------------------ */
/* View model shared by UI and scene                                   */
/* ------------------------------------------------------------------ */

export type ViewMode = 'exterior' | 'building' | 'floor' | 'room';

export type SelectionKind = 'room' | 'agent' | 'task' | 'floor' | null;

export interface Selection {
  readonly kind: SelectionKind;
  readonly id: string | null;
}
