/**
 * Agent domain: assignment integrity and status rules.
 *
 * An agent always has a room and a workstation in that room. Agent status is
 * derived from the operational layer; it is never a free-floating label.
 */
import type { Agent, AgentStatus, Building, Task } from './types';
import type { ValidationIssue } from './space';

export const AGENT_STATUS_LABELS: Readonly<Record<AgentStatus, string>> = {
  IDLE: 'Idle',
  WORKING: 'Working',
  WAITING: 'Waiting',
  ERROR: 'Error',
  OFFLINE: 'Offline',
};

export const AGENT_ACCENTS: Readonly<Record<Agent['accent'], string>> = {
  cyan: '#54d6e6',
  violet: '#9d8bf5',
  amber: '#e2b263',
  lime: '#a9d47a',
  rose: '#e58fa6',
  slate: '#8c9aab',
};

export interface AgentIndex {
  readonly byId: ReadonlyMap<string, Agent>;
  readonly byRoom: ReadonlyMap<string, Agent[]>;
  readonly byWorkstation: ReadonlyMap<string, Agent>;
}

export function indexAgents(agents: readonly Agent[]): AgentIndex {
  const byId = new Map<string, Agent>();
  const byRoom = new Map<string, Agent[]>();
  const byWorkstation = new Map<string, Agent>();
  for (const agent of agents) {
    byId.set(agent.id, agent);
    const room = byRoom.get(agent.roomId) ?? [];
    room.push(agent);
    byRoom.set(agent.roomId, room);
    byWorkstation.set(agent.workstationId, agent);
  }
  return { byId, byRoom, byWorkstation };
}

/**
 * Cross-entity consistency checks. Reports hard errors where the spatial
 * assignment is broken and warnings where the operational picture is stale.
 */
export function validateAssignments(
  building: Building,
  agents: readonly Agent[],
  tasks: readonly Task[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rooms = new Map(
    building.floors.flatMap((floor) => floor.rooms.map((room) => [room.id, { room, floor }] as const)),
  );
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const seenWorkstations = new Map<string, string>();
  const seenAgents = new Set<string>();

  for (const agent of agents) {
    if (seenAgents.has(agent.id)) {
      issues.push({
        code: 'agent.duplicateId',
        severity: 'error',
        message: `Duplicate agent id "${agent.id}".`,
      });
    }
    seenAgents.add(agent.id);

    const entry = rooms.get(agent.roomId);
    if (!entry) {
      issues.push({
        code: 'agent.roomMissing',
        severity: 'error',
        message: `Agent "${agent.id}" references missing room "${agent.roomId}".`,
        roomId: agent.roomId,
      });
      continue;
    }
    const { room, floor } = entry;
    if (floor.department !== agent.department) {
      issues.push({
        code: 'agent.departmentMismatch',
        severity: 'warning',
        message: `Agent "${agent.id}" is in ${floor.department} but declared under ${agent.department}.`,
        roomId: room.id,
      });
    }

    const workstation = room.workstations.find((ws) => ws.id === agent.workstationId);
    if (!workstation) {
      issues.push({
        code: 'agent.workstationMissing',
        severity: 'error',
        message: `Agent "${agent.id}" references workstation "${agent.workstationId}" which does not exist in "${room.id}".`,
        roomId: room.id,
      });
    } else if (seenWorkstations.has(workstation.id)) {
      issues.push({
        code: 'agent.workstationConflict',
        severity: 'error',
        message: `Workstation "${workstation.id}" is assigned to both "${seenWorkstations.get(workstation.id)}" and "${agent.id}".`,
        roomId: room.id,
      });
    } else {
      seenWorkstations.set(workstation.id, agent.id);
    }

    if (agent.currentTaskId) {
      const task = tasksById.get(agent.currentTaskId);
      if (!task) {
        issues.push({
          code: 'agent.taskMissing',
          severity: 'error',
          message: `Agent "${agent.id}" references missing task "${agent.currentTaskId}".`,
        });
      } else {
        if (task.agentId !== agent.id) {
          issues.push({
            code: 'agent.taskOwnerMismatch',
            severity: 'error',
            message: `Task "${task.id}" is shown on agent "${agent.id}" but is assigned to "${task.agentId ?? 'nobody'}".`,
          });
        }
        if (task.status !== 'RUNNING' && task.status !== 'WAITING') {
          issues.push({
            code: 'agent.taskNotActive',
            severity: 'error',
            message: `Agent "${agent.id}" holds task "${task.id}" which is ${task.status}.`,
          });
        }
      }
    }

    if (agent.status === 'WORKING' && !agent.currentTaskId) {
      issues.push({
        code: 'agent.workingWithoutTask',
        severity: 'error',
        message: `Agent "${agent.id}" is WORKING without a task.`,
      });
    }
    if (agent.status === 'IDLE' && agent.currentTaskId) {
      issues.push({
        code: 'agent.idleWithTask',
        severity: 'error',
        message: `Agent "${agent.id}" is IDLE but still holds task "${agent.currentTaskId}".`,
      });
    }
  }

  for (const task of tasks) {
    if (!rooms.has(task.roomId)) {
      issues.push({
        code: 'task.roomMissing',
        severity: 'error',
        message: `Task "${task.id}" references missing room "${task.roomId}".`,
        roomId: task.roomId,
      });
    }
    if (task.agentId) {
      const agent = agents.find((candidate) => candidate.id === task.agentId);
      if (!agent) {
        issues.push({
          code: 'task.agentMissing',
          severity: 'error',
          message: `Task "${task.id}" references missing agent "${task.agentId}".`,
        });
      } else {
        if (agent.roomId !== task.roomId) {
          issues.push({
            code: 'task.roomMismatch',
            severity: 'error',
            message: `Task "${task.id}" is scoped to "${task.roomId}" but its agent "${agent.id}" sits in "${agent.roomId}".`,
            roomId: task.roomId,
          });
        }
        if (agent.department !== task.department) {
          issues.push({
            code: 'task.departmentMismatch',
            severity: 'warning',
            message: `Task "${task.id}" is declared under ${task.department} but its agent belongs to ${agent.department}.`,
          });
        }
      }
    }
    for (const dependencyId of task.dependsOn) {
      const dependency = tasksById.get(dependencyId);
      if (!dependency) {
        issues.push({
          code: 'task.dependencyMissing',
          severity: 'error',
          message: `Task "${task.id}" depends on missing task "${dependencyId}".`,
        });
      } else if (dependency.id === task.id) {
        issues.push({
          code: 'task.selfDependency',
          severity: 'error',
          message: `Task "${task.id}" depends on itself.`,
        });
      }
    }
  }

  return issues;
}

/** Agent status implied by the tasks it currently holds. */
export function derivedAgentStatus(agent: Agent, tasks: readonly Task[]): AgentStatus {
  if (agent.status === 'OFFLINE') return 'OFFLINE';
  if (!agent.currentTaskId) return agent.status === 'ERROR' ? 'ERROR' : 'IDLE';
  const task = tasks.find((candidate) => candidate.id === agent.currentTaskId);
  if (!task) return 'IDLE';
  switch (task.status) {
    case 'RUNNING':
      return 'WORKING';
    case 'WAITING':
      return 'WAITING';
    case 'FAILED':
      return 'ERROR';
    default:
      return 'IDLE';
  }
}
