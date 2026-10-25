import { describe, expect, it } from 'vitest';
import agentsFixture from '@/data/agents.json';
import buildingFixture from '@/data/building.json';
import tasksFixture from '@/data/tasks.json';
import { parseAgents, parseTasks } from '@/domain/schema';
import { loadBuilding } from '@/domain/building';
import { createOperationsState } from '@/domain/operations';
import { appearanceFor, hashString, seedFor } from '@/scene/character/appearance';
import {
  bodyParts,
  chairParts,
  characterBudget,
  visibleParts,
  type ChairPart,
} from '@/scene/character/parts';
import {
  buildPose,
  solveSkeleton,
  type PoseInput,
  type SeatedActivity,
  type StandingActivity,
} from '@/scene/character/pose';
import {
  awayFacing,
  awayPoint,
  behaviourFor,
  walkFacing,
  phaseOffsetFor,
  restMotion,
  seatedMixAt,
  stepMotion,
  workActivity,
  type CharacterMotion,
} from '@/scene/character/behaviour';
import { roleColor } from '@/scene/character/characterMaterials';

const agents = parseAgents(agentsFixture);
const tasks = parseTasks(tasksFixture);
const { building } = loadBuilding(buildingFixture);

const SEATED: SeatedActivity[] = ['IDLE_SEATED', 'TYPING', 'USING_MOUSE', 'READING_SCREEN', 'THINKING'];
const STANDING: StandingActivity[] = ['IDLE_STANDING', 'WAITING', 'ERROR_REVIEW'];

function poseInput(overrides: Partial<PoseInput> = {}): PoseInput {
  const app = appearanceFor('agent-001');
  return {
    seated: 'TYPING',
    standing: 'IDLE_STANDING',
    seatedMix: 1,
    walkPhase: 0,
    walking: 0,
    time: 3.4,
    seed: 0.42,
    proportions: app.proportions,
    ...overrides,
  };
}

describe('character appearance', () => {
  it('is deterministic per agent id', () => {
    const first = appearanceFor('agent-014');
    const second = appearanceFor('agent-014');
    expect(second).toEqual(first);
    expect(seedFor('agent-014')).toBe(seedFor('agent-014'));
    expect(hashString('agent-014')).toBe(hashString('agent-014'));
    expect(seedFor('agent-014')).not.toBe(seedFor('agent-015'));
  });

  it('keeps every colleague in a plausible human range', () => {
    for (const agent of agents) {
      const app = appearanceFor(agent.id);
      expect(app.height).toBeGreaterThanOrEqual(1.62);
      expect(app.height).toBeLessThanOrEqual(1.86);
      expect(app.build).toBeGreaterThan(0.9);
      expect(app.build).toBeLessThan(1.1);
      // Leg segments must add up to the hip height, otherwise a standing
      // character would float or sink.
      const p = app.proportions;
      expect(p.thigh + p.shin + p.ankle).toBeCloseTo(p.hipHeight, 6);
      expect(phaseOffsetFor(agent.id)).toBeGreaterThanOrEqual(0);
      expect(phaseOffsetFor(agent.id)).toBeLessThan(40);
    }
  });

  it('produces a varied but coherent workforce', () => {
    const outfits = new Set<string>();
    const hair = new Set<string>();
    const skins = new Set<string>();
    for (const agent of agents) {
      const app = appearanceFor(agent.id);
      outfits.add(`${app.top.color}|${app.lower.kind}|${app.jacket ?? '-'}`);
      hair.add(`${app.hairStyle}|${app.hairColor}`);
      skins.add(app.skin);
      expect(roleColor('top', app)).toBe(app.top.color);
      expect(roleColor('skin', app)).toBe(app.skin);
    }
    expect(skins.size).toBeGreaterThanOrEqual(4);
    expect(hair.size).toBeGreaterThanOrEqual(6);
    expect(outfits.size).toBeGreaterThanOrEqual(10);
  });
});

describe('character geometry catalogue', () => {
  it('models detailed humans, not capsules', () => {
    const app = appearanceFor('agent-003');
    const parts = bodyParts(app);
    const ids = parts.map((part) => part.id);
    const compact = visibleParts(parts, 'compact');
    expect(parts.length).toBeGreaterThanOrEqual(35);
    expect(compact.length).toBeLessThan(parts.length / 2);
    for (const id of ['skull', 'jaw', 'nose', 'hand-L', 'hand-R', 'fingers-L', 'shoe-L', 'heel-L']) {
      expect(ids).toContain(id);
    }
    // Glasses only when the appearance asks for them.
    expect(ids.some((id) => id.startsWith('lens-'))).toBe(app.glasses);
  });

  it('keeps every part inside the skeleton it is attached to', () => {
    for (const agent of agents) {
      const app = appearanceFor(agent.id);
      const p = app.proportions;
      for (const part of bodyParts(app)) {
        const [sx, sy, sz] = part.scale;
        expect(sx).toBeGreaterThan(0);
        expect(sy).toBeGreaterThan(0);
        expect(sz).toBeGreaterThan(0);
        if (part.id.startsWith('upper-arm')) expect(sy).toBeCloseTo(p.upperArm, 6);
        if (part.id.startsWith('forearm')) expect(sy).toBeCloseTo(p.forearm, 6);
        if (part.id.startsWith('thigh')) expect(sy).toBeCloseTo(p.thigh, 6);
        if (part.id.startsWith('shin')) expect(sy).toBeCloseTo(p.shin, 6);
        for (const value of part.position) expect(Math.abs(value)).toBeLessThan(0.6);
      }
    }
  });

  it('sizes the chair to the occupant', () => {
    const app = appearanceFor('agent-011');
    const seat = chairParts(app.proportions.seatedHipHeight).find(
      (part: ChairPart) => part.id === 'chair-seat',
    );
    expect(seat).toBeDefined();
    const seatTop = seat!.position[1] + seat!.scale[1] / 2;
    // The hip joint sits a few centimetres above the cushion.
    expect(seatTop).toBeLessThan(app.proportions.seatedHipHeight);
    expect(app.proportions.seatedHipHeight - seatTop).toBeLessThan(0.08);
    expect(seatTop).toBeGreaterThan(0.4);
  });

  it('reports a draw-call budget for both tiers', () => {
    const app = appearanceFor('agent-021');
    const budget = characterBudget(app);
    expect(budget.bodyParts).toBeLessThan(budget.fullBodyParts);
    expect(budget.chairParts).toBeLessThan(budget.fullChairParts);
    expect(budget.fullBodyParts + budget.fullChairParts).toBeLessThan(80);
    expect(budget.bodyParts + budget.chairParts).toBeLessThan(25);
  });
});

describe('pose engine', () => {
  it('plants the lower foot on the floor for every state, seed and time', () => {
    const times = [0, 0.4, 1.7, 3.2, 7.5, 12.9];
    for (const agent of agents.slice(0, 8)) {
      const app = appearanceFor(agent.id);
      for (const seated of SEATED) {
        for (const standing of STANDING) {
          for (const mix of [0, 0.35, 1]) {
            for (const time of times) {
              const pose = buildPose(
                poseInput({
                  seated,
                  standing,
                  seatedMix: mix,
                  walking: mix === 0 ? 1 : 0,
                  walkPhase: time * 2,
                  time,
                  seed: seedFor(agent.id),
                  proportions: app.proportions,
                }),
              );
              const points = solveSkeleton(pose, app.proportions);
              const lowest = Math.min(points.soleL.y, points.soleR.y);
              expect(Math.abs(lowest)).toBeLessThan(0.001);
              expect(pose.hipHeight).toBeGreaterThan(0.4);
              expect(pose.hipHeight).toBeLessThan(1.1);
            }
          }
        }
      }
    }
  });

  it('rests the hands on the desk plane while seated', () => {
    for (const agent of agents.slice(0, 10)) {
      const app = appearanceFor(agent.id);
      const pose = buildPose(
        poseInput({
          seated: 'TYPING',
          seatedMix: 1,
          time: 2.5,
          seed: seedFor(agent.id),
          proportions: app.proportions,
        }),
      );
      const points = solveSkeleton(pose, app.proportions);
      for (const wrist of [points.wristL, points.wristR]) {
        // Desk top is at 0.74 m; hands rest on the keyboard just above it.
        expect(wrist.y).toBeGreaterThan(0.68);
        expect(wrist.y).toBeLessThan(0.9);
        expect(wrist.z).toBeGreaterThan(0.3);
      }
      // Knees forward of the hips, shins roughly vertical.
      expect(points.kneeL.z).toBeGreaterThan(0.3);
      expect(Math.abs(points.ankleL.z - points.kneeL.z)).toBeLessThan(0.08);
    }
  });

  it('keeps a standing figure at the requested height', () => {
    for (const agent of agents.slice(0, 10)) {
      const app = appearanceFor(agent.id);
      const pose = buildPose(
        poseInput({
          seatedMix: 0,
          standing: 'IDLE_STANDING',
          time: 1.9,
          seed: seedFor(agent.id),
          proportions: app.proportions,
        }),
      );
      const points = solveSkeleton(pose, app.proportions);
      expect(points.headTop.y).toBeCloseTo(app.height, 1);
    }
  });

  it('alternates hands while typing', () => {
    const strides = Array.from({ length: 180 }, (_, i) =>
      buildPose(poseInput({ seated: 'TYPING', time: i / 30 })),
    );
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const wristL = strides.map((pose) => pose.joints.wristL.x);
    const wristR = strides.map((pose) => pose.joints.wristR.x);
    const meanL = mean(wristL);
    const meanR = mean(wristR);
    let opposite = 0;
    let samples = 0;
    let amplitude = 0;
    for (let i = 0; i < strides.length; i += 1) {
      const dL = (wristL[i] ?? 0) - meanL;
      const dR = (wristR[i] ?? 0) - meanR;
      amplitude = Math.max(amplitude, Math.abs(dL));
      if (Math.abs(dL) > 0.01 && Math.abs(dR) > 0.01) {
        samples += 1;
        if (Math.sign(dL) !== Math.sign(dR)) opposite += 1;
      }
    }
    // The hands must actually move and must move out of phase.
    expect(amplitude).toBeGreaterThan(0.06);
    expect(samples).toBeGreaterThan(80);
    expect(opposite / samples).toBeGreaterThan(0.9);
    const fingers = strides.map((pose) => pose.fingersL - pose.fingersR);
    expect(Math.max(...fingers) - Math.min(...fingers)).toBeGreaterThan(0.2);
  });

  it('keeps idle motion restrained', () => {
    let maxHeadYaw = 0;
    let maxSpine = 0;
    let maxHipDrift = 0;
    for (const agent of agents.slice(0, 6)) {
      const app = appearanceFor(agent.id);
      let minHip = Infinity;
      let maxHip = -Infinity;
      for (let i = 0; i < 240; i += 1) {
        const pose = buildPose(
          poseInput({
            seated: 'IDLE_SEATED',
            seatedMix: 1,
            time: i * 0.1,
            seed: seedFor(agent.id),
            proportions: app.proportions,
          }),
        );
        maxHeadYaw = Math.max(maxHeadYaw, Math.abs(pose.joints.head.y));
        maxSpine = Math.max(maxSpine, Math.abs(pose.joints.spine.x));
        minHip = Math.min(minHip, pose.hipHeight);
        maxHip = Math.max(maxHip, pose.hipHeight);
      }
      maxHipDrift = Math.max(maxHipDrift, maxHip - minHip);
    }
    expect(maxHeadYaw).toBeLessThan(0.45);
    expect(maxSpine).toBeLessThan(0.25);
    // A seated idle sways a couple of millimetres, it does not bob.
    expect(maxHipDrift).toBeLessThan(0.02);
  });

  it('desynchronises idle phases between colleagues', () => {
    const offsets = new Set(agents.map((agent) => phaseOffsetFor(agent.id).toFixed(3)));
    expect(offsets.size).toBe(agents.length);
    const first = agents.map((agent) => workActivity(agent.id, 30));
    expect(new Set(first).size).toBeGreaterThan(1);
    // Deterministic blocks: same agent and time always give the same answer.
    expect(workActivity('agent-004', 30)).toBe(workActivity('agent-004', 30));
  });
});

describe('operational behaviour mapping', () => {
  const state = createOperationsState(tasks, agents);

  it('separates business status from physical posture', () => {
    const labels = new Set<string>();
    for (const agent of state.agents) {
      const task = agent.currentTaskId
        ? state.tasks.find((candidate) => candidate.id === agent.currentTaskId) ?? null
        : null;
      const behaviour = behaviourFor(agent, task);
      labels.add(`${agent.status}:${behaviour.away}:${behaviour.seated}:${behaviour.standing}`);
      if (agent.status === 'OFFLINE') {
        expect(behaviour.visible).toBe(false);
        expect(behaviour.away).toBe(true);
      }
      if (agent.status === 'WAITING' || agent.status === 'ERROR') {
        expect(behaviour.visible).toBe(true);
        expect(behaviour.away).toBe(true);
      }
      if (agent.status === 'WORKING' || agent.status === 'IDLE') {
        expect(behaviour.away).toBe(false);
      }
      expect(behaviour.label.length).toBeGreaterThan(3);
    }
    expect(labels.size).toBeGreaterThanOrEqual(3);
  });

  it('explains why a waiting agent left the chair', () => {
    const waiting = state.agents.find((agent) => agent.status === 'WAITING');
    expect(waiting).toBeDefined();
    const behaviour = behaviourFor(waiting!, null);
    expect(behaviour.standing).toBe('WAITING');
    expect(behaviour.reason).toMatch(/prerequisite|depend/i);
  });
});

describe('character locomotion', () => {
  it('blends the sit transition over the first centimetres', () => {
    expect(seatedMixAt(0)).toBe(1);
    expect(seatedMixAt(0.09)).toBeCloseTo(0.5, 5);
    expect(seatedMixAt(0.3)).toBe(0);
  });

  it('walks to the waiting spot and stops exactly there', () => {
    const side = 1 as const;
    const seat = { x: 2, z: -3 };
    const facing = 0.4;
    const away = awayPoint(seat, facing, side);
    const target = Math.hypot(away.x - seat.x, away.z - seat.z);
    expect(target).toBeGreaterThan(0.5);

    let motion: CharacterMotion = restMotion;
    let elapsed = 0;
    const dt = 1 / 60;
    while (elapsed < 3) {
      motion = stepMotion(motion, target, dt);
      elapsed += dt;
    }
    expect(motion.progress).toBeCloseTo(target, 5);
    expect(motion.moving).toBe(false);
    expect(motion.seatedMix).toBe(0);
    expect(Number.isFinite(motion.phase)).toBe(true);
    // 0.85 m/s: a ~0.8 m step takes roughly one second, not one frame.
    expect(elapsed).toBeGreaterThan(0.5);

    // Walking back returns to a seated pose without overshooting.
    let back = motion;
    for (let i = 0; i < 300; i += 1) back = stepMotion(back, 0, dt);
    expect(back.progress).toBe(0);
    expect(back.seatedMix).toBe(1);
  });

  it('never overshoots or moves backwards in one step', () => {
    let motion = restMotion;
    for (let i = 0; i < 400; i += 1) {
      motion = stepMotion(motion, 0.6, 0.016);
      expect(motion.progress).toBeGreaterThanOrEqual(0);
      expect(motion.progress).toBeLessThanOrEqual(0.6 + 1e-9);
    }
    expect(motion.progress).toBeCloseTo(0.6, 6);
  });

  it('turns toward the direction of travel while stepping out', () => {
    const facing = 0.6;
    expect(walkFacing(facing, 1)).toBeCloseTo(facing + Math.PI / 2, 6);
    expect(walkFacing(facing, -1)).toBeCloseTo(facing - Math.PI / 2, 6);
    // And settles facing the desk it just left, slightly angled.
    expect(Math.abs(awayFacing(facing, 1) - facing)).toBeLessThan(0.5);
  });

  it('keeps the away point in front of the desk, not inside it', () => {
    const seat = { x: 0, z: 0 };
    for (const side of [-1, 1] as const) {
      const away = awayPoint(seat, 0, side);
      // Character faces +z here; the desk is at +z, so the waiting spot is
      // behind and to one side of the chair.
      expect(away.z).toBeLessThan(0);
      expect(Math.abs(away.x)).toBeGreaterThan(0.4);
    }
  });
});

describe('character budget in the real building', () => {
  it('fits the full-detail rig in every room', () => {
    let seats = 0;
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        seats += room.workstations.length;
      }
    }
    expect(seats).toBeGreaterThanOrEqual(agents.length);
    const budget = characterBudget(appearanceFor('agent-001'));
    expect(budget.fullBodyParts * agents.length).toBeLessThan(2000);
  });
});
