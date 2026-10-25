'use client';

/**
 * Activity system: the single owner of every colleague's autonomous behaviour.
 *
 * `AgentLayer` publishes the operational context (agent, task, workstation,
 * meeting slot) whenever operations change; the one shared frame loop advances
 * all activity machines; rigs read the resulting activity for their pose and
 * destination. Nothing here re-renders React during animation, and there is no
 * per-agent timer or render loop.
 */
import type { Agent, Building } from '@/domain/types';
import {
  createActivity,
  destinationId,
  meetingPlan,
  stepActivity,
  type ActivityContext,
  type AgentActivity,
  type MeetingSlot,
} from './activity';

const activities = new Map<string, AgentActivity>();
const contexts = new Map<string, ActivityContext>();
/** Destination key each rig has already reached, reported by the body. */
const arrived = new Map<string, string>();
let clock = 0;
let meetingTimer = 0;
let buildingHolder: Building | null = null;

export function destinationKey(destination: AgentActivity['destination']): string {
  return destinationId(destination);
}

/**
 * Publishes the current operational context for every rendered colleague.
 *
 * Called from an effect, so joining/leaving/relocating an agent or a task
 * changing state is picked up reactively without reloading the scene. An
 * agent that was already known keeps its activity (and therefore its history);
 * its machine simply re-reads the new facts next frame.
 */
export function syncActivities(next: ActivityContext[]): void {
  const known = new Set<string>();
  for (const context of next) {
    known.add(context.agent.id);
    const previous = contexts.get(context.agent.id);
    const current = activities.get(context.agent.id);
    const facingChange =
      !previous ||
      previous.homeFloorId !== context.homeFloorId ||
      previous.homeRoomId !== context.homeRoomId ||
      Math.abs(previous.homeSeat.x - context.homeSeat.x) > 0.01 ||
      Math.abs(previous.homeSeat.z - context.homeSeat.z) > 0.01;
    contexts.set(context.agent.id, context);
    if (!current) {
      // A newcomer is standing at its workstation, which is where the rig
      // draws it on the first frame.
      const created = createActivity(context);
      activities.set(context.agent.id, created);
      // A newcomer starts at its own workstation, even if a meeting is
      // already scheduled: it still has to walk there.
      arrived.set(
        context.agent.id,
        destinationKey({
          kind: 'workstation',
          floorId: context.homeFloorId,
          roomId: context.homeRoomId,
          point: context.homeSeat,
          facing: context.homeFacing,
          chairId: null,
        }),
      );
      continue;
    }
    if (facingChange) {
      // A relocation is a new destination: the body has to walk there.
      arrived.delete(context.agent.id);
    }
  }
  for (const id of [...contexts.keys()]) {
    if (known.has(id)) continue;
    contexts.delete(id);
    activities.delete(id);
    arrived.delete(id);
  }
}

/** True when the body has reached the activity destination it was sent to. */
function atDestination(activity: AgentActivity): boolean {
  const key = destinationKey(activity.destination);
  if (activity.animation.posture === 'STANDING' && activity.destination.kind === 'workstation') {
    // Standing beside the desk never needs a walk across the floor.
    return true;
  }
  return arrived.get(activity.agentId) === key;
}

/** Called by a rig once it is standing on the activity destination. */
export function reportArrival(agentId: string): void {
  const activity = activities.get(agentId);
  if (!activity) return;
  arrived.set(agentId, destinationKey(activity.destination));
}

/** Advances every activity machine by one frame. Single shared scheduler. */
export function stepActivities(dt: number): void {
  const step = dt > 0.1 ? 0.1 : dt;
  clock += step;
  const known = [...contexts.values()];
  if (known.length === 0) return;

  // Meeting convening changes slowly; recomputing it every two seconds keeps
  // the per-frame cost flat while staying reactive.
  meetingTimer += step;
  let plan: Map<string, MeetingSlot> | null = null;
  if (meetingTimer >= 2) {
    meetingTimer = 0;
    const roster = known.map((context) => context.agent);
    if (meetingSource) plan = meetingSource(clock, roster);
    else if (buildingHolder) plan = meetingPlan(buildingHolder, roster, clock);
    else plan = new Map();
  }

  for (const context of known) {
    const current = activities.get(context.agent.id);
    if (!current) continue;
    const meeting = plan ? (plan.get(context.agent.id) ?? null) : context.meeting;
    const nextContext: ActivityContext = { ...context, meeting };
    contexts.set(context.agent.id, nextContext);
    activities.set(
      context.agent.id,
      stepActivity(current, { ...nextContext, atDestination: atDestination(current) }, step),
    );
  }
}

/**
 * The building is needed to convene meetings. `AgentLayer` hands it over once;
 * keeping it here avoids threading it through every rig.
 */
export function setActivityBuilding(building: Building): void {
  buildingHolder = building;
}

export function agentActivity(agentId: string): AgentActivity | null {
  return activities.get(agentId) ?? null;
}

/** Snapshot used by React renderers; never mutated in place. */
export const activityFor = agentActivity;

export function activityCount(): number {
  return activities.size;
}

export function activityClock(): number {
  return clock;
}

export type MeetingSource = (elapsed: number, agents: readonly Agent[]) => Map<string, MeetingSlot>;

let meetingSource: MeetingSource | null = null;

/** Replace the meeting schedule (tests, or a future real calendar feed). */
export function setMeetingSource(source: MeetingSource | null): void {
  meetingSource = source;
}

export function resetActivities(): void {
  activities.clear();
  contexts.clear();
  arrived.clear();
  clock = 0;
  meetingTimer = 0;
  buildingHolder = null;
  meetingSource = null;
}
