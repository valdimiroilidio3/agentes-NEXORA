/**
 * Operational state → physical behaviour, and the short-range locomotion that
 * moves a character between the chair and the spot where it waits.
 *
 * Everything here is pure and deterministic: the mapping from an agent's
 * operational status to an activity, the schedule of micro-activities while
 * working, and the motion integrator used for standing up, stepping aside and
 * sitting back down.
 */
import type { Agent, Task, Vec2 } from '@/domain/types';
import { hashString, seededRandom, seedFor } from './appearance';
import type { SeatedActivity, StandingActivity } from './pose';

export interface AgentBehaviour {
  /** Character is drawn at all. Offline colleagues leave an empty chair. */
  readonly visible: boolean;
  /** True when the character leaves the chair and stands beside the desk. */
  readonly away: boolean;
  readonly seated: SeatedActivity;
  readonly standing: StandingActivity;
  /** Which side of the desk the character waits on. */
  readonly side: 1 | -1;
  readonly label: string;
  readonly reason: string;
}

export function behaviourFor(agent: Agent, task: Task | null): AgentBehaviour {
  const side: 1 | -1 = (hashString(agent.id) & 1) === 0 ? 1 : -1;
  switch (agent.status) {
    case 'OFFLINE':
      return {
        visible: false,
        away: true,
        seated: 'IDLE_SEATED',
        standing: 'IDLE_STANDING',
        side,
        label: 'Away from desk',
        reason: 'Agent is offline; the chair is empty.',
      };
    case 'ERROR':
      return {
        visible: true,
        away: true,
        seated: 'READING_SCREEN',
        standing: 'ERROR_REVIEW',
        side,
        label: 'Reviewing a failure',
        reason: task?.error?.message ?? 'The last run failed; the agent stepped away to review it.',
      };
    case 'WAITING':
      return {
        visible: true,
        away: true,
        seated: 'IDLE_SEATED',
        standing: 'WAITING',
        side,
        label: 'Waiting on a dependency',
        reason: 'Blocked until a prerequisite task completes.',
      };
    case 'WORKING':
      return {
        visible: true,
        away: false,
        seated: 'TYPING',
        standing: 'IDLE_STANDING',
        side,
        label: 'Working at the desk',
        reason: task ? `Task “${task.title}” is running.` : 'Working.',
      };
    default:
      return {
        visible: true,
        away: false,
        seated: 'IDLE_SEATED',
        standing: 'IDLE_STANDING',
        side,
        label: 'At the desk, idle',
        reason: 'No assigned work; the agent stays at its workstation.',
      };
  }
}

const WORK_BLOCK_SECONDS = 7;

/**
 * Micro-activity while a task runs. Deterministic per (agent, 7 s block), so
 * two colleagues never cycle in lockstep and the choice is reproducible.
 */
export function workActivity(agentId: string, seconds: number): SeatedActivity {
  const block = Math.max(0, Math.floor(seconds / WORK_BLOCK_SECONDS));
  const random = seededRandom(hashString(`work:${agentId}:${block}`));
  const roll = random();
  if (roll < 0.6) return 'TYPING';
  if (roll < 0.76) return 'USING_MOUSE';
  if (roll < 0.91) return 'READING_SCREEN';
  return 'THINKING';
}

/** Phase offset in seconds so idle animations never start together. */
export function phaseOffsetFor(agentId: string): number {
  return seedFor(agentId) * 40;
}

/* ------------------------------------------------------------------ */
/* Locomotion                                                          */
/* ------------------------------------------------------------------ */

export interface CharacterMotion {
  /** Distance travelled from the chair, in metres. */
  readonly progress: number;
  /** Distance travelled during the current move, drives the walk cycle. */
  readonly travelled: number;
  readonly phase: number;
  readonly moving: boolean;
  /** 1 = seated, 0 = standing. */
  readonly seatedMix: number;
  readonly walking: number;
}

export const SIT_TRANSITION_METRES = 0.18;
export const WALK_SPEED = 0.85;

export const restMotion: CharacterMotion = {
  progress: 0,
  travelled: 0,
  phase: 0,
  moving: false,
  seatedMix: 1,
  walking: 0,
};

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Blend envelope for the sit/stand transition at the start of the path. */
export function seatedMixAt(progress: number): number {
  return 1 - clamp(progress / SIT_TRANSITION_METRES, 0, 1);
}

export function walkingAt(moving: boolean, progress: number): number {
  if (!moving) return 0;
  return clamp((progress - 0.06) / 0.16, 0, 1);
}

/**
 * Advances a character along its short path (chair → waiting spot).
 * `dt` is the real frame delta; the result never overshoots the target.
 */
export function stepMotion(
  motion: CharacterMotion,
  target: number,
  dt: number,
  speed = WALK_SPEED,
): CharacterMotion {
  const step = Math.max(0, Math.min(0.1, dt)) * speed;
  const distance = clamp(target, 0, 1.2) - motion.progress;
  const delta = Math.sign(distance) * Math.min(Math.abs(distance), step);
  const progress = motion.progress + delta;
  const moving = Math.abs(delta) > 1e-5;
  return {
    progress,
    travelled: moving ? motion.travelled + Math.abs(delta) : 0,
    phase: moving ? motion.phase + (Math.abs(delta) / 1.36) * Math.PI * 2 : motion.phase,
    moving,
    seatedMix: seatedMixAt(progress),
    walking: walkingAt(moving, progress),
  };
}

/** Point beside the chair where a standing character waits. */
export function awayPoint(seat: Vec2, facing: number, side: 1 | -1): Vec2 {
  const lateral = 0.66;
  const back = 0.46;
  const rightX = Math.cos(facing);
  const rightZ = -Math.sin(facing);
  const forwardX = Math.sin(facing);
  const forwardZ = Math.cos(facing);
  return {
    x: seat.x + rightX * lateral * side - forwardX * back,
    z: seat.z + rightZ * lateral * side - forwardZ * back,
  };
}

/** Facing while away: turned slightly toward the desk they just left. */
export function awayFacing(facing: number, side: 1 | -1): number {
  return facing - side * 0.35;
}

/** Facing for a character stepping along a short lateral path. */
export function walkFacing(facing: number, side: 1 | -1): number {
  return facing + (side * Math.PI) / 2;
}
