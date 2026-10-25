/**
 * Character part catalogue.
 *
 * The renderer and the draw-call budget both read this list, so a part can
 * never exist in the scene without being counted, and the two LOD tiers are
 * explicit data instead of render-time conditionals.
 *
 * Geometry is expressed in metres inside the parent joint's local space. The
 * joint layout lives in `pose.ts` and is shared with the forward-kinematics
 * solver used by tests.
 */
import type { JointName } from './pose';
import type { CharacterAppearance } from './appearance';

export type PrimitiveKind = 'box' | 'sphere' | 'cylinder';

export type PartMaterial =
  | 'skin'
  | 'hair'
  | 'eye'
  | 'top'
  | 'jacket'
  | 'lower'
  | 'shoes'
  | 'metal'
  | 'dark'
  | 'glasses'
  | 'white'
  | 'accent';

export type DetailLevel = 'full' | 'compact';

export interface BodyPart {
  readonly id: string;
  readonly joint: JointName;
  readonly geometry: PrimitiveKind;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly material: PartMaterial;
  /** Compact parts are drawn at both tiers; full parts only at `full`. */
  readonly tier: DetailLevel;
  /** Parts the animation loop drives directly (fingers). */
  readonly animated?: 'fingers';
}

export interface ChairPart {
  readonly id: string;
  readonly geometry: PrimitiveKind;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly material: 'fabric' | 'fabricLight' | 'metal' | 'darkMetal';
  readonly tier: DetailLevel;
}

const v = (x: number, y: number, z: number): readonly [number, number, number] => [x, y, z];

/**
 * Builds the body for one appearance. `height` scaling is already baked into
 * proportions; `build` widens the torso and shoulders only.
 */
export function bodyParts(app: CharacterAppearance): BodyPart[] {
  const p = app.proportions;
  const b = app.build;
  const h = p.height;
  const parts: BodyPart[] = [];
  const add = (part: BodyPart): void => {
    parts.push(part);
  };

  const upperRole: PartMaterial = app.jacket ? 'jacket' : 'top';
  const coveredLegs = app.lower.kind === 'trousers';

  /* ---------------- pelvis ---------------- */
  add({
    id: 'pelvis',
    joint: 'hips',
    geometry: 'box',
    position: v(0, -0.015, 0),
    scale: v(0.30 * b, 0.15, 0.20),
    material: 'lower',
    tier: 'compact',
  });
  add({
    id: 'belt',
    joint: 'hips',
    geometry: 'box',
    position: v(0, 0.058, 0),
    scale: v(0.305 * b, 0.032, 0.205),
    material: 'dark',
    tier: 'full',
  });
  if (app.lower.kind === 'skirt') {
    add({
      id: 'skirt',
      joint: 'hips',
      geometry: 'cylinder',
      position: v(0, -0.14, 0),
      scale: v(0.40 * b, 0.34, 0.36),
      material: 'lower',
      tier: 'compact',
    });
  }

  /* ---------------- torso ---------------- */
  add({
    id: 'waist',
    joint: 'spine',
    geometry: 'cylinder',
    position: v(0, 0.045, 0),
    scale: v(0.285 * b, 0.20, 0.20),
    material: upperRole,
    tier: 'compact',
  });
  add({
    id: 'chest',
    joint: 'chest',
    geometry: 'cylinder',
    position: v(0, 0.055, 0),
    scale: v(0.345 * b, 0.20, 0.235),
    material: upperRole,
    tier: 'compact',
  });
  add({
    id: 'shoulder-l',
    joint: 'chest',
    geometry: 'sphere',
    position: v(-0.152 * b, 0.105, 0),
    scale: v(0.135 * b, 0.12, 0.15),
    material: upperRole,
    tier: 'full',
  });
  add({
    id: 'shoulder-r',
    joint: 'chest',
    geometry: 'sphere',
    position: v(0.152 * b, 0.105, 0),
    scale: v(0.135 * b, 0.12, 0.15),
    material: upperRole,
    tier: 'full',
  });

  if (app.jacket) {
    // Open jacket: two fronts showing the shirt between them.
    add({
      id: 'jacket-front-l',
      joint: 'chest',
      geometry: 'box',
      position: v(-0.075 * b, 0.045, 0.108),
      scale: v(0.085, 0.29, 0.028),
      rotation: v(0, 0, -0.05),
      material: 'jacket',
      tier: 'full',
    });
    add({
      id: 'jacket-front-r',
      joint: 'chest',
      geometry: 'box',
      position: v(0.075 * b, 0.045, 0.108),
      scale: v(0.085, 0.29, 0.028),
      rotation: v(0, 0, 0.05),
      material: 'jacket',
      tier: 'full',
    });
  }
  if (app.top.kind === 'shirt' || app.top.kind === 'blouse') {
    add({
      id: 'collar-l',
      joint: 'chest',
      geometry: 'box',
      position: v(-0.045, 0.132, 0.088),
      scale: v(0.075, 0.045, 0.02),
      rotation: v(0.15, 0, -0.55),
      material: 'white',
      tier: 'full',
    });
    add({
      id: 'collar-r',
      joint: 'chest',
      geometry: 'box',
      position: v(0.045, 0.132, 0.088),
      scale: v(0.075, 0.045, 0.02),
      rotation: v(0.15, 0, 0.55),
      material: 'white',
      tier: 'full',
    });
  }
  if (app.jacket && app.top.kind === 'shirt') {
    add({
      id: 'tie-knot',
      joint: 'chest',
      geometry: 'box',
      position: v(0, 0.115, 0.105),
      scale: v(0.032, 0.045, 0.02),
      material: 'accent',
      tier: 'full',
    });
    add({
      id: 'tie',
      joint: 'chest',
      geometry: 'box',
      position: v(0, 0.02, 0.108),
      scale: v(0.045, 0.17, 0.014),
      material: 'accent',
      tier: 'full',
    });
  }
  add({
    // Tall enough to bridge the collar and the base of the skull: no gap at
    // the throat, and the lower half stays hidden inside the shirt.
    id: 'neck',
    joint: 'neck',
    geometry: 'cylinder',
    position: v(0, 0.028, 0),
    scale: v(0.078, 0.145, 0.078),
    material: 'skin',
    tier: 'compact',
  });

  /* ---------------- head ---------------- */
  const headY = p.headHeight / 2;
  add({
    id: 'skull',
    joint: 'head',
    geometry: 'sphere',
    position: v(0, headY, 0.004),
    scale: v(0.155, 0.19, 0.175),
    material: 'skin',
    tier: 'compact',
  });
  add({
    id: 'jaw',
    joint: 'head',
    geometry: 'sphere',
    position: v(0, headY - 0.045, 0.022),
    scale: v(0.128, 0.105, 0.15),
    material: 'skin',
    tier: 'full',
  });
  add({
    id: 'nose',
    joint: 'head',
    geometry: 'box',
    position: v(0, headY - 0.008, 0.082),
    scale: v(0.026, 0.045, 0.036),
    rotation: v(0.18, 0, 0),
    material: 'skin',
    tier: 'full',
  });
  for (const side of [-1, 1] as const) {
    add({
      id: `ear-${side}`,
      joint: 'head',
      geometry: 'sphere',
      position: v(side * 0.076, headY + 0.002, 0),
      scale: v(0.024, 0.045, 0.032),
      material: 'skin',
      tier: 'full',
    });
    add({
      id: `eye-${side}`,
      joint: 'head',
      geometry: 'sphere',
      position: v(side * 0.034, headY + 0.018, 0.072),
      scale: v(0.022, 0.018, 0.012),
      material: 'eye',
      tier: 'full',
    });
    add({
      id: `brow-${side}`,
      joint: 'head',
      geometry: 'box',
      position: v(side * 0.035, headY + 0.043, 0.074),
      scale: v(0.042, 0.008, 0.012),
      rotation: v(0, 0, side * 0.08),
      material: 'hair',
      tier: 'full',
    });
  }

  /* hair */
  if (app.hairStyle !== 'bald') {
    add({
      id: 'hair-cap',
      joint: 'head',
      geometry: 'sphere',
      position: v(0, headY + 0.022, -0.004),
      scale: v(0.164, 0.168, 0.182),
      material: 'hair',
      tier: 'compact',
    });
    if (app.hairStyle === 'short-crop' || app.hairStyle === 'side-part') {
      add({
        id: 'hair-fringe',
        joint: 'head',
        geometry: 'box',
        position: v(app.hairStyle === 'side-part' ? 0.022 : 0, headY + 0.062, 0.062),
        scale: v(0.115, 0.035, 0.055),
        rotation: v(0.12, 0, app.hairStyle === 'side-part' ? -0.22 : 0),
        material: 'hair',
        tier: 'full',
      });
    } else if (app.hairStyle === 'bun') {
      add({
        id: 'hair-bun',
        joint: 'head',
        geometry: 'sphere',
        position: v(0, headY + 0.055, -0.088),
        scale: v(0.085, 0.08, 0.075),
        material: 'hair',
        tier: 'full',
      });
    } else if (app.hairStyle === 'ponytail') {
      add({
        id: 'hair-tail',
        joint: 'head',
        geometry: 'cylinder',
        position: v(0, headY - 0.045, -0.078),
        scale: v(0.05, 0.19, 0.05),
        rotation: v(-0.16, 0, 0),
        material: 'hair',
        tier: 'full',
      });
    } else {
      const curls = [
        { x: -0.045, y: 0.09 },
        { x: 0.045, y: 0.09 },
        { x: 0, y: 0.12 },
      ];
      for (const [index, curl] of curls.entries()) {
        add({
          id: `hair-curl-${index}`,
          joint: 'head',
          geometry: 'sphere',
          position: v(curl.x, headY + curl.y, -0.01),
          scale: v(0.075, 0.07, 0.08),
          material: 'hair',
          tier: 'full',
        });
      }
    }
  }
  if (app.facialHair) {
    add({
      id: 'beard',
      joint: 'head',
      geometry: 'box',
      position: v(0, headY - 0.05, 0.045),
      scale: v(0.105, 0.06, 0.075),
      material: 'hair',
      tier: 'full',
    });
  }
  if (app.glasses) {
    for (const side of [-1, 1] as const) {
      add({
        id: `lens-${side}`,
        joint: 'head',
        geometry: 'box',
        position: v(side * 0.035, headY + 0.018, 0.082),
        scale: v(0.058, 0.04, 0.006),
        material: 'glasses',
        tier: 'full',
      });
      add({
        id: `temple-${side}`,
        joint: 'head',
        geometry: 'box',
        position: v(side * 0.074, headY + 0.022, 0.025),
        scale: v(0.006, 0.007, 0.11),
        material: 'metal',
        tier: 'full',
      });
    }
    add({
      id: 'lens-bridge',
      joint: 'head',
      geometry: 'box',
      position: v(0, headY + 0.022, 0.084),
      scale: v(0.024, 0.007, 0.006),
      material: 'metal',
      tier: 'full',
    });
  }

  /* ---------------- arms ---------------- */
  for (const side of [-1, 1] as const) {
    const suffix = side === -1 ? 'L' : 'R';
    const shoulderJoint = `shoulder${suffix}` as JointName;
    const elbowJoint = `elbow${suffix}` as JointName;
    const wristJoint = `wrist${suffix}` as JointName;

    add({
      id: `upper-arm-${suffix}`,
      joint: shoulderJoint,
      geometry: 'cylinder',
      position: v(0, -p.upperArm / 2, 0),
      scale: v(0.095 * b, p.upperArm, 0.095),
      material: upperRole,
      tier: 'compact',
    });
    add({
      id: `forearm-${suffix}`,
      joint: elbowJoint,
      geometry: 'cylinder',
      position: v(0, -p.forearm / 2, 0),
      scale: v(0.078, p.forearm, 0.078),
      material: upperRole,
      tier: 'compact',
    });
    add({
      id: `cuff-${suffix}`,
      joint: elbowJoint,
      geometry: 'cylinder',
      position: v(0, -p.forearm + 0.02, 0),
      scale: v(0.082, 0.035, 0.082),
      material: app.top.kind === 'shirt' ? 'white' : upperRole,
      tier: 'full',
    });
    add({
      id: `hand-${suffix}`,
      joint: wristJoint,
      geometry: 'box',
      position: v(0, -0.038, 0.004),
      scale: v(0.072, 0.075, 0.042),
      material: 'skin',
      tier: 'full',
    });
    add({
      id: `thumb-${suffix}`,
      joint: wristJoint,
      geometry: 'box',
      position: v(side * 0.036, -0.03, 0.022),
      scale: v(0.02, 0.045, 0.022),
      rotation: v(0.2, 0, side * 0.35),
      material: 'skin',
      tier: 'full',
    });
    add({
      id: `fingers-${suffix}`,
      joint: wristJoint,
      geometry: 'box',
      position: v(0, -0.095, 0.006),
      scale: v(0.066, 0.055, 0.032),
      material: 'skin',
      tier: 'full',
      animated: 'fingers',
    });
  }

  /* ---------------- legs ---------------- */
  for (const side of [-1, 1] as const) {
    const suffix = side === -1 ? 'L' : 'R';
    const hipJoint = `hip${suffix}` as JointName;
    const kneeJoint = `knee${suffix}` as JointName;
    const ankleJoint = `ankle${suffix}` as JointName;

    add({
      id: `thigh-${suffix}`,
      joint: hipJoint,
      geometry: 'cylinder',
      position: v(0, -p.thigh / 2, 0),
      scale: v(0.145 * b, p.thigh, 0.145),
      material: coveredLegs ? 'lower' : 'skin',
      tier: 'compact',
    });
    add({
      id: `shin-${suffix}`,
      joint: kneeJoint,
      geometry: 'cylinder',
      position: v(0, -p.shin / 2, 0),
      scale: v(0.11, p.shin, 0.11),
      material: coveredLegs ? 'lower' : 'skin',
      tier: 'compact',
    });
    add({
      id: `shoe-${suffix}`,
      joint: ankleJoint,
      geometry: 'box',
      position: v(0, -p.ankle / 2, 0.035),
      scale: v(0.095, p.ankle, 0.215),
      material: 'shoes',
      tier: 'compact',
    });
    add({
      id: `heel-${suffix}`,
      joint: ankleJoint,
      geometry: 'box',
      position: v(0, -p.ankle + 0.018, -0.05),
      scale: v(0.088, 0.05, 0.055),
      material: 'shoes',
      tier: 'full',
    });
  }

  return parts;
}

/** Task chair. Kept as data for the same reason as the body. */
export function chairParts(seatHeight: number): ChairPart[] {
  const parts: ChairPart[] = [
    {
      id: 'chair-base',
      geometry: 'cylinder',
      position: v(0, 0.024, 0),
      scale: v(0.62, 0.045, 0.62),
      material: 'darkMetal',
      tier: 'compact',
    },
    {
      id: 'chair-post',
      geometry: 'cylinder',
      position: v(0, seatHeight * 0.5, 0),
      scale: v(0.062, seatHeight, 0.062),
      material: 'metal',
      tier: 'compact',
    },
    {
      id: 'chair-seat',
      geometry: 'box',
      position: v(0, seatHeight - 0.07, 0),
      scale: v(0.5, 0.05, 0.47),
      material: 'fabric',
      tier: 'compact',
    },
    {
      id: 'chair-back',
      geometry: 'box',
      position: v(0, seatHeight + 0.29, -0.235),
      scale: v(0.45, 0.46, 0.055),
      rotation: v(-0.08, 0, 0),
      material: 'fabric',
      tier: 'compact',
    },
  ];
  const detail: ChairPart[] = [
    {
      id: 'chair-cushion',
      geometry: 'box',
      position: v(0, seatHeight - 0.043, 0.01),
      scale: v(0.46, 0.026, 0.44),
      material: 'fabricLight',
      tier: 'full',
    },
    {
      id: 'chair-lumbar',
      geometry: 'box',
      position: v(0, seatHeight + 0.19, -0.205),
      scale: v(0.33, 0.17, 0.03),
      material: 'fabricLight',
      tier: 'full',
    },
    {
      id: 'chair-spine',
      geometry: 'box',
      position: v(0, seatHeight + 0.12, -0.268),
      scale: v(0.06, 0.3, 0.035),
      material: 'darkMetal',
      tier: 'full',
    },
  ];
  for (const side of [-1, 1] as const) {
    detail.push({
      id: `chair-arm-post-${side}`,
      geometry: 'box',
      position: v(side * 0.235, seatHeight + 0.005, 0.02),
      scale: v(0.035, 0.16, 0.035),
      material: 'darkMetal',
      tier: 'full',
    });
    detail.push({
      id: `chair-arm-pad-${side}`,
      geometry: 'box',
      position: v(side * 0.235, seatHeight + 0.09, 0.04),
      scale: v(0.06, 0.028, 0.26),
      material: 'fabricLight',
      tier: 'full',
    });
    detail.push({
      id: `chair-castor-${side}`,
      geometry: 'box',
      position: v(side * 0.22, 0.05, side * 0.14),
      scale: v(0.055, 0.06, 0.055),
      material: 'darkMetal',
      tier: 'full',
    });
  }
  detail.push({
    id: 'chair-castor-c',
    geometry: 'box',
    position: v(0, 0.05, -0.26),
    scale: v(0.055, 0.06, 0.055),
    material: 'darkMetal',
    tier: 'full',
  });
  return [...parts, ...detail];
}

export function visibleParts<T extends { readonly tier: DetailLevel }>(
  parts: readonly T[],
  detail: DetailLevel,
): readonly T[] {
  return detail === 'full' ? parts : parts.filter((part) => part.tier === 'compact');
}

/** Harness/armrest clearance: how far the chair occupies around the seat. */
export const CHAIR_RADIUS = 0.34;

export interface CharacterBudget {
  readonly bodyParts: number;
  readonly fullBodyParts: number;
  readonly chairParts: number;
  readonly fullChairParts: number;
}

export function characterBudget(app: CharacterAppearance): CharacterBudget {
  const body = bodyParts(app);
  const chair = chairParts(app.proportions.seatedHipHeight);
  return {
    bodyParts: visibleParts(body, 'compact').length,
    fullBodyParts: body.length,
    chairParts: visibleParts(chair, 'compact').length,
    fullChairParts: chair.length,
  };
}
