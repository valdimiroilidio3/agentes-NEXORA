/**
 * Procedural character pose engine.
 *
 * Pure maths — no React, no Three.js — so the skeleton can be unit tested:
 * we assert that feet rest on the floor, that a seated character's hands land
 * on the desk plane, that typing alternates hands, and that every joint stays
 * inside a plausible range for every seed and every frame.
 *
 * Rig conventions
 * ---------------
 * - Character local space: +y up, +z forward (the direction the character
 *   faces), +x to the character's left.
 * - Every joint rotates with an Euler triple in radians:
 *   `x` = pitch (negative leans forward), `y` = yaw, `z` = roll.
 * - Limb chains hang downwards in the neutral pose; a hinge chain rotated by
 *   pitch `a` moves its end by `(0, -L·cos a, -L·sin a)`, so negative pitch
 *   swings a limb forward.
 * - Units are metres. `height` is the standing height without hair.
 */

export const TAU = Math.PI * 2;

export type JointName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'shoulderL'
  | 'elbowL'
  | 'wristL'
  | 'shoulderR'
  | 'elbowR'
  | 'wristR'
  | 'hipL'
  | 'kneeL'
  | 'ankleL'
  | 'hipR'
  | 'kneeR'
  | 'ankleR';

export interface JointRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const ZERO: JointRotation = { x: 0, y: 0, z: 0 };

/** Seated activities are performed on the office chair. */
export type SeatedActivity =
  | 'IDLE_SEATED'
  | 'TYPING'
  | 'USING_MOUSE'
  | 'READING_SCREEN'
  | 'THINKING';

/** Standing activities happen beside the workstation. */
export type StandingActivity = 'IDLE_STANDING' | 'WAITING' | 'ERROR_REVIEW';

export type PhysicalActivity = SeatedActivity | StandingActivity | 'WALKING';

/* ------------------------------------------------------------------ */
/* Proportions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Canonical 7.7-head figure. Every length is a fraction of standing height,
 * which keeps a 1.62 m and a 1.86 m colleague proportionally consistent.
 */
export interface Proportions {
  readonly height: number;
  readonly headHeight: number;
  readonly neckLength: number;
  readonly hipHeight: number;
  /** Hip joint → centre of the chest. */
  readonly torso: number;
  readonly shoulderWidth: number;
  readonly hipWidth: number;
  readonly upperArm: number;
  readonly forearm: number;
  readonly hand: number;
  readonly thigh: number;
  readonly shin: number;
  readonly ankle: number;
  readonly seatedHipHeight: number;
}

export const STANDING_HEIGHT_MIN = 1.62;
export const STANDING_HEIGHT_MAX = 1.86;

export function proportionsFor(height: number): Proportions {
  const h = Math.min(STANDING_HEIGHT_MAX, Math.max(STANDING_HEIGHT_MIN, height));
  const shin = 0.246 * h;
  const ankle = 0.039 * h;
  return {
    height: h,
    headHeight: 0.13 * h,
    neckLength: 0.06 * h,
    hipHeight: 0.53 * h,
    torso: 0.29 * h,
    shoulderWidth: 0.205 * h,
    hipWidth: 0.055 * h,
    upperArm: 0.186 * h,
    forearm: 0.146 * h,
    hand: 0.1 * h,
    thigh: 0.245 * h,
    shin,
    ankle,
    // Knees level with the hips, shins vertical, soles flat on the floor.
    seatedHipHeight: shin + ankle,
  };
}

/** Local joint offsets. Mirrored joints (L/R) are produced by the sign. */
export interface SkeletonLayout {
  readonly spine: Vec3;
  readonly chest: Vec3;
  readonly neck: Vec3;
  readonly head: Vec3;
  readonly shoulderX: number;
  readonly shoulderY: number;
  readonly elbow: Vec3;
  readonly wrist: Vec3;
  readonly hipJointX: number;
  readonly hipJointY: number;
  readonly knee: Vec3;
  readonly ankle: Vec3;
}

export function layoutFor(p: Proportions): SkeletonLayout {
  return {
    // Hip 0.53 h → spine 0.64 h → chest 0.76 h → shoulder 0.81 h →
    // neck 0.84 h → skull base 0.87 h → crown 1.00 h.
    spine: { x: 0, y: 0.11 * p.height, z: 0 },
    chest: { x: 0, y: 0.12 * p.height, z: 0 },
    neck: { x: 0, y: 0.08 * p.height, z: -0.004 },
    head: { x: 0, y: 0.03 * p.height, z: 0 },
    shoulderX: p.shoulderWidth / 2,
    shoulderY: 0.05 * p.height,
    elbow: { x: 0, y: -p.upperArm, z: 0 },
    wrist: { x: 0, y: -p.forearm, z: 0 },
    hipJointX: p.hipWidth,
    hipJointY: 0,
    knee: { x: 0, y: -p.thigh, z: 0 },
    ankle: { x: 0, y: -p.shin, z: 0 },
  };
}

/* ------------------------------------------------------------------ */
/* Pose                                                                */
/* ------------------------------------------------------------------ */

export interface CharacterPose {
  /** Height of the hip joint above the floor plane. */
  readonly hipHeight: number;
  /** 1 = fully seated on the chair, 0 = standing. */
  readonly seatedMix: number;
  readonly joints: Readonly<Record<JointName, JointRotation>>;
  /** Finger curl 0 (open) … 1 (curled over a key). */
  readonly fingersL: number;
  readonly fingersR: number;
}

export interface PoseInput {
  readonly seated: SeatedActivity;
  readonly standing: StandingActivity;
  readonly seatedMix: number;
  /** Accumulated walking phase in radians. */
  readonly walkPhase: number;
  /** 0 = still, 1 = full stride. */
  readonly walking: number;
  readonly time: number;
  /** Stable per-agent seed (0..1). */
  readonly seed: number;
  readonly proportions: Proportions;
}

type MutablePose = Record<JointName, JointRotation> & {
  hipHeight: number;
  seatedMix: number;
  fingersL: number;
  fingersR: number;
};

function blank(): MutablePose {
  const joints = {} as Record<JointName, JointRotation>;
  for (const name of Object.keys(ZERO_HOLDER) as JointName[]) joints[name] = ZERO;
  return { ...joints, hipHeight: 0, seatedMix: 0, fingersL: 0, fingersR: 0 };
}

const ZERO_HOLDER: Record<JointName, 0> = {
  hips: 0,
  spine: 0,
  chest: 0,
  neck: 0,
  head: 0,
  shoulderL: 0,
  elbowL: 0,
  wristL: 0,
  shoulderR: 0,
  elbowR: 0,
  wristR: 0,
  hipL: 0,
  kneeL: 0,
  ankleL: 0,
  hipR: 0,
  kneeR: 0,
  ankleR: 0,
};

export const JOINT_NAMES: readonly JointName[] = Object.keys(ZERO_HOLDER) as JointName[];

function set(
  pose: MutablePose,
  joint: JointName,
  x: number,
  y = 0,
  z = 0,
): void {
  pose[joint] = { x, y, z };
}

function add(pose: MutablePose, joint: JointName, x: number, y = 0, z = 0): void {
  const current = pose[joint];
  pose[joint] = { x: current.x + x, y: current.y + y, z: current.z + z };
}

/** Deterministic pseudo-random value in [-1, 1] for a seed/step pair. */
export function noise(seed: number, step: number): number {
  const s = Math.sin((seed * 127.1 + step * 311.7) * 43758.5453);
  return (s - Math.floor(s)) * 2 - 1;
}

/** Smooth 0..1 envelope that only fires for part of a period. */
function pulse(t: number, period: number, phase: number, duty = 0.5): number {
  const u = ((t / period + phase) % 1 + 1) % 1;
  if (u > duty) return 0;
  return Math.sin((u / duty) * Math.PI);
}

/* ------------------------------------------------------------------ */
/* Poses                                                               */
/* ------------------------------------------------------------------ */

function seatedBase(pose: MutablePose, p: Proportions): void {
  pose.hipHeight = p.seatedHipHeight;
  set(pose, 'hips', 0, 0, 0);
  // Thighs horizontal, shins vertical, soles flat: no clipping into the slab.
  set(pose, 'hipL', -Math.PI / 2, 0.06, 0.03);
  set(pose, 'kneeL', Math.PI / 2, 0, 0);
  set(pose, 'hipR', -Math.PI / 2, -0.06, -0.03);
  set(pose, 'kneeR', Math.PI / 2, 0, 0);
  set(pose, 'ankleL', 0, 0, 0);
  set(pose, 'ankleR', 0, 0, 0);
  // Elbows just below the desk top, forearms horizontal so the hands rest on
  // the keyboard plane instead of floating above it or sinking into the desk.
  set(pose, 'shoulderL', -0.7, 0.16, 0.12);
  set(pose, 'elbowL', -0.78, 0, 0);
  set(pose, 'wristL', 0.12, 0, 0);
  set(pose, 'shoulderR', -0.7, -0.16, -0.12);
  set(pose, 'elbowR', -0.78, 0, 0);
  set(pose, 'wristR', 0.12, 0, 0);
  pose.fingersL = 0.35;
  pose.fingersR = 0.35;
}

function standingBase(pose: MutablePose, p: Proportions): void {
  pose.hipHeight = p.hipHeight;
  set(pose, 'hips', 0, 0, 0);
  set(pose, 'hipL', 0.02, 0.1, 0.03);
  set(pose, 'kneeL', 0.03, 0, 0);
  set(pose, 'ankleL', 0, 0, 0);
  set(pose, 'hipR', -0.02, -0.1, -0.03);
  set(pose, 'kneeR', 0.03, 0, 0);
  set(pose, 'ankleR', 0, 0, 0);
  set(pose, 'shoulderL', 0.06, 0.08, 0.08);
  set(pose, 'elbowL', -0.18, 0, 0);
  set(pose, 'wristL', 0, 0, 0);
  set(pose, 'shoulderR', 0.06, -0.08, -0.08);
  set(pose, 'elbowR', -0.18, 0, 0);
  set(pose, 'wristR', 0, 0, 0);
  pose.fingersL = 0.18;
  pose.fingersR = 0.18;
}

/** Adds the chosen seated activity. */
function applySeatedActivity(
  pose: MutablePose,
  activity: SeatedActivity,
  t: number,
  seed: number,
): void {
  const phase = seed * TAU * 3;
  // Breathing, weight shift and a slow attention drift are shared by all
  // seated states; every character uses its own phase so nothing synchronises.
  add(pose, 'spine', -0.1 + Math.sin(t * 0.62 + phase) * 0.012, Math.sin(t * 0.21 + phase) * 0.02);
  add(pose, 'chest', Math.sin(t * 0.62 + phase + 0.6) * 0.008);
  add(pose, 'hips', 0, 0, Math.sin(t * 0.17 + phase * 1.7) * 0.015);

  const glance =
    Math.sin(t * 0.23 + phase) * 0.16 + Math.sin(t * 0.11 + phase * 2.3) * 0.08;

  switch (activity) {
    case 'TYPING': {
      const cadence = 6.4 + seed * 2.2;
      add(pose, 'shoulderL', -0.02, 0);
      add(pose, 'elbowL', -0.04 + Math.sin(t * cadence + phase) * 0.03);
      add(pose, 'wristL', Math.sin(t * cadence + phase) * 0.11);
      add(pose, 'elbowR', -0.04 + Math.sin(t * cadence + phase + Math.PI) * 0.03);
      add(pose, 'wristR', Math.sin(t * cadence + phase + Math.PI) * 0.11);
      pose.fingersL = 0.45 + Math.sin(t * cadence + phase) * 0.3;
      pose.fingersR = 0.45 + Math.sin(t * cadence + phase + Math.PI) * 0.3;
      add(pose, 'head', -0.12 + Math.sin(t * 0.4 + phase) * 0.02, glance * 0.35);
      break;
    }
    case 'USING_MOUSE': {
      // Right hand travels to the mouse, left hand rests on the keyboard.
      const reach = pulse(t, 9, seed, 0.85);
      add(pose, 'shoulderR', -0.18 - reach * 0.1, -0.14);
      add(pose, 'elbowR', -0.12, 0);
      add(pose, 'wristR', -0.05);
      add(pose, 'wristL', Math.sin(t * 1.6 + phase) * 0.03);
      pose.fingersR = 0.62;
      pose.fingersL = 0.3;
      add(pose, 'head', -0.14, glance * 0.5 - 0.12);
      break;
    }
    case 'READING_SCREEN': {
      add(pose, 'shoulderL', 0.08, 0.05);
      add(pose, 'shoulderR', 0.08, -0.05);
      add(pose, 'elbowL', 0.12);
      add(pose, 'elbowR', 0.12);
      add(pose, 'head', -0.2 + Math.sin(t * 0.35 + phase) * 0.02, glance * 0.6);
      pose.fingersL = 0.22;
      pose.fingersR = 0.22;
      break;
    }
    case 'THINKING': {
      // Chin rests on the right hand: restrained, no theatrical gestures.
      const drift = pulse(t, 14, seed, 0.7);
      add(pose, 'shoulderR', -0.62 - drift * 0.05, -0.2);
      add(pose, 'elbowR', -0.75);
      add(pose, 'wristR', 0.35);
      add(pose, 'shoulderL', 0.02, 0.12);
      add(pose, 'elbowL', -0.2);
      add(pose, 'head', -0.08, glance * 0.45, 0.06);
      add(pose, 'chest', 0, glance * 0.05);
      pose.fingersR = 0.55;
      pose.fingersL = 0.4;
      break;
    }
    default: {
      // IDLE_SEATED: upright, hands near the keyboard, occasional posture shift.
      const shift = pulse(t, 17, seed * 1.3, 0.45);
      add(pose, 'spine', shift * 0.03, 0, 0);
      add(pose, 'head', -0.04, glance, Math.sin(t * 0.19 + phase) * 0.03);
      add(pose, 'shoulderL', 0.06 + shift * 0.04);
      add(pose, 'shoulderR', 0.06 + shift * 0.04);
      pose.fingersL = 0.28;
      pose.fingersR = 0.28;
      break;
    }
  }
}

function applyStandingActivity(
  pose: MutablePose,
  activity: StandingActivity,
  t: number,
  seed: number,
): void {
  const phase = seed * TAU * 3;
  add(pose, 'hips', 0, Math.sin(t * 0.18 + phase) * 0.02, Math.sin(t * 0.21 + phase) * 0.03);
  add(pose, 'spine', -0.02 + Math.sin(t * 0.58 + phase) * 0.012, Math.sin(t * 0.13 + phase) * 0.03);
  const glance = Math.sin(t * 0.27 + phase) * 0.24 + Math.sin(t * 0.09 + phase * 1.9) * 0.1;

  switch (activity) {
    case 'WAITING': {
      // Weight on one leg, hands loosely clasped, occasional look to the door.
      add(pose, 'hipL', 0.04, 0, 0.03);
      add(pose, 'kneeL', 0.12);
      add(pose, 'hipR', -0.05, 0, -0.02);
      add(pose, 'shoulderL', -0.14, 0.24, 0.2);
      add(pose, 'elbowL', -0.62);
      add(pose, 'shoulderR', -0.14, -0.24, -0.2);
      add(pose, 'elbowR', -0.62);
      add(pose, 'head', 0.02, glance, 0.02);
      pose.fingersL = 0.45;
      pose.fingersR = 0.45;
      break;
    }
    case 'ERROR_REVIEW': {
      // Arms folded, slow head shake: reading a failure, not performing it.
      add(pose, 'shoulderL', -0.2, 0.32, 0.34);
      add(pose, 'elbowL', -1.55);
      add(pose, 'wristL', 0.18);
      add(pose, 'shoulderR', -0.2, -0.32, -0.34);
      add(pose, 'elbowR', -1.55);
      add(pose, 'wristR', 0.18);
      add(pose, 'head', -0.06, Math.sin(t * 0.5 + phase) * 0.13, 0.02);
      add(pose, 'spine', 0.04);
      pose.fingersL = 0.3;
      pose.fingersR = 0.3;
      break;
    }
    default: {
      // IDLE_STANDING: relaxed arms, slow weight shift, subtle breathing.
      add(pose, 'shoulderL', 0.02, 0.06, 0.06 + Math.sin(t * 0.3 + phase) * 0.02);
      add(pose, 'shoulderR', 0.02, -0.06, -0.06 - Math.sin(t * 0.3 + phase) * 0.02);
      add(pose, 'elbowL', -0.16 + Math.sin(t * 0.45 + phase) * 0.03);
      add(pose, 'elbowR', -0.16 + Math.sin(t * 0.45 + phase + 1.2) * 0.03);
      add(pose, 'head', -0.02, glance * 0.8);
      pose.fingersL = 0.2;
      pose.fingersR = 0.2;
      break;
    }
  }
}

/** Additive walking cycle layered over the standing base. */
function applyWalk(pose: MutablePose, phase: number, amount: number): void {
  if (amount <= 0.001) return;
  const stride = Math.sin(phase);
  const lift = Math.max(0, Math.cos(phase));

  add(pose, 'hipL', -0.42 * stride * amount, 0, 0.02);
  add(pose, 'kneeL', (0.18 + 0.5 * lift) * amount, 0, 0);
  add(pose, 'ankleL', (-0.12 * stride - 0.1) * amount, 0, 0);

  add(pose, 'hipR', 0.42 * stride * amount, 0, -0.02);
  add(pose, 'kneeR', (0.18 + 0.5 * Math.max(0, -Math.cos(phase))) * amount, 0, 0);
  add(pose, 'ankleR', (0.12 * stride - 0.1) * amount, 0, 0);

  add(pose, 'shoulderL', 0.3 * stride * amount, 0.04);
  add(pose, 'elbowL', (-0.22 - 0.16 * Math.max(0, -stride)) * amount);
  add(pose, 'shoulderR', -0.3 * stride * amount, -0.04);
  add(pose, 'elbowR', (-0.22 - 0.16 * Math.max(0, stride)) * amount);

  add(pose, 'spine', -0.03 * amount, -0.09 * stride * amount, 0);
  add(pose, 'chest', 0, 0.05 * stride * amount);
  add(pose, 'head', 0, -0.03 * stride * amount);
  // Vertical bob: peak when a foot passes the other.
  pose.hipHeight -= Math.abs(Math.cos(phase)) * 0.018 * amount + 0.005 * amount;
  // Slight pull away from the floor so the planted foot never sinks.
  pose.hipHeight += 0.006 * amount;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blendSeatedStanding(
  target: MutablePose,
  seated: MutablePose,
  standing: MutablePose,
  mix: number,
): void {
  for (const joint of JOINT_NAMES) {
    const a = seated[joint];
    const b = standing[joint];
    target[joint] = {
      x: lerpAngle(a.x, b.x, 1 - mix),
      y: lerpAngle(a.y, b.y, 1 - mix),
      z: lerpAngle(a.z, b.z, 1 - mix),
    };
  }
  target.hipHeight = seated.hipHeight * mix + standing.hipHeight * (1 - mix);
  target.fingersL = seated.fingersL * mix + standing.fingersL * (1 - mix);
  target.fingersR = seated.fingersR * mix + standing.fingersR * (1 - mix);
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

export function buildPose(input: PoseInput): CharacterPose {
  const mix = clamp01(input.seatedMix);
  const walking = clamp01(input.walking);
  const p = input.proportions;

  const seated = blank();
  seated.seatedMix = 1;
  seatedBase(seated, p);
  applySeatedActivity(seated, input.seated, input.time, input.seed);

  const standing = blank();
  standingBase(standing, p);
  applyStandingActivity(standing, input.standing, input.time, input.seed);
  applyWalk(standing, input.walkPhase, walking);

  const target = blank();
  target.seatedMix = mix;
  blendSeatedStanding(target, seated, standing, mix);

  const composed: CharacterPose = {
    hipHeight: target.hipHeight,
    seatedMix: mix,
    joints: {
      hips: target.hips,
      spine: target.spine,
      chest: target.chest,
      neck: target.neck,
      head: target.head,
      shoulderL: target.shoulderL,
      elbowL: target.elbowL,
      wristL: target.wristL,
      shoulderR: target.shoulderR,
      elbowR: target.elbowR,
      wristR: target.wristR,
      hipL: target.hipL,
      kneeL: target.kneeL,
      ankleL: target.ankleL,
      hipR: target.hipR,
      kneeR: target.kneeR,
      ankleR: target.ankleR,
    },
    fingersL: clamp01(target.fingersL),
    fingersR: clamp01(target.fingersR),
  };

  // Grounding: whatever the pose, the lower sole rests exactly on the floor.
  // This is what prevents floating and sinking feet during the walk cycle.
  const points = solveSkeleton(composed, p);
  const lowestSole = Math.min(points.soleL.y, points.soleR.y);
  if (!Number.isFinite(lowestSole)) return composed;
  return { ...composed, hipHeight: composed.hipHeight - lowestSole };
}

/* ------------------------------------------------------------------ */
/* Forward kinematics (verification)                                   */
/* ------------------------------------------------------------------ */

type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function rotX(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

function rotY(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function rotZ(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    const r0 = a[row * 3] ?? 0;
    const r1 = a[row * 3 + 1] ?? 0;
    const r2 = a[row * 3 + 2] ?? 0;
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] = r0 * (b[col] ?? 0) + r1 * (b[3 + col] ?? 0) + r2 * (b[6 + col] ?? 0);
    }
  }
  return out as unknown as Mat3;
}

function apply(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

function rotationOf(j: JointRotation): Mat3 {
  return mul(mul(rotY(j.y), rotX(j.x)), rotZ(j.z));
}

const plus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export interface SkeletonPoints {
  readonly hips: Vec3;
  readonly chest: Vec3;
  readonly head: Vec3;
  /** Top of the skull, for scale verification. */
  readonly headTop: Vec3;
  readonly shoulderL: Vec3;
  readonly shoulderR: Vec3;
  readonly elbowL: Vec3;
  readonly elbowR: Vec3;
  readonly wristL: Vec3;
  readonly wristR: Vec3;
  readonly kneeL: Vec3;
  readonly kneeR: Vec3;
  readonly ankleL: Vec3;
  readonly ankleR: Vec3;
  /** Bottom of the sole. */
  readonly soleL: Vec3;
  readonly soleR: Vec3;
}

/**
 * Resolves world-space joint positions for a pose. Used by tests (feet on the
 * floor, hands at the desk plane) and by the scene for the chair anchor.
 */
export function solveSkeleton(pose: CharacterPose, p: Proportions): SkeletonPoints {
  const l = layoutFor(p);
  const hipsPos: Vec3 = { x: 0, y: pose.hipHeight, z: 0 };
  const hipsRot = rotationOf(pose.joints.hips);
  const spinePos = plus(hipsPos, apply(hipsRot, l.spine));
  const spineRot = mul(hipsRot, rotationOf(pose.joints.spine));
  const chestPos = plus(spinePos, apply(spineRot, l.chest));
  const chestRot = mul(spineRot, rotationOf(pose.joints.chest));
  const neckPos = plus(chestPos, apply(chestRot, l.neck));
  const neckRot = mul(chestRot, rotationOf(pose.joints.neck));
  const headPos = plus(neckPos, apply(neckRot, l.head));
  const headRot = mul(neckRot, rotationOf(pose.joints.head));

  const shoulder = (side: 'L' | 'R'): Vec3 => {
    const sign = side === 'L' ? 1 : -1;
    return plus(chestPos, apply(chestRot, { x: sign * l.shoulderX, y: l.shoulderY, z: 0 }));
  };
  const armChain = (side: 'L' | 'R') => {
    const shoulderPos = shoulder(side);
    const shoulderRot = mul(chestRot, rotationOf(pose.joints[`shoulder${side}`]));
    const elbowPos = plus(shoulderPos, apply(shoulderRot, l.elbow));
    const elbowRot = mul(shoulderRot, rotationOf(pose.joints[`elbow${side}`]));
    const wristPos = plus(elbowPos, apply(elbowRot, l.wrist));
    return { shoulderPos, elbowPos, wristPos };
  };
  const legChain = (side: 'L' | 'R') => {
    const sign = side === 'L' ? 1 : -1;
    const hipPos = plus(hipsPos, apply(hipsRot, { x: sign * l.hipJointX, y: l.hipJointY, z: 0 }));
    const hipRot = mul(hipsRot, rotationOf(pose.joints[`hip${side}`]));
    const kneePos = plus(hipPos, apply(hipRot, l.knee));
    const kneeRot = mul(hipRot, rotationOf(pose.joints[`knee${side}`]));
    const anklePos = plus(kneePos, apply(kneeRot, l.ankle));
    const ankleRot = mul(kneeRot, rotationOf(pose.joints[`ankle${side}`]));
    const sole = plus(anklePos, apply(ankleRot, { x: 0, y: -p.ankle, z: 0.02 * p.height }));
    return { kneePos, anklePos, sole };
  };

  const armL = armChain('L');
  const armR = armChain('R');
  const legL = legChain('L');
  const legR = legChain('R');
  // The head joint sits at the base of the skull, so the crown is one full
  // head height above it.
  const headTop = plus(headPos, apply(headRot, { x: 0, y: p.headHeight, z: 0 }));

  return {
    hips: hipsPos,
    chest: chestPos,
    head: headPos,
    headTop,
    shoulderL: armL.shoulderPos,
    shoulderR: armR.shoulderPos,
    elbowL: armL.elbowPos,
    elbowR: armR.elbowPos,
    wristL: armL.wristPos,
    wristR: armR.wristPos,
    kneeL: legL.kneePos,
    kneeR: legR.kneePos,
    ankleL: legL.anklePos,
    ankleR: legR.anklePos,
    soleL: legL.sole,
    soleR: legR.sole,
  };
}

export { IDENTITY };
