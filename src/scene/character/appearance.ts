/**
 * Deterministic character appearance.
 *
 * Every agent id maps to exactly one appearance, so a colleague looks the same
 * in every session. The palette is deliberately narrow (brand palette plus
 * neutral office clothing) so the workforce reads as one company instead of a
 * bag of random colours.
 */
import { proportionsFor, type Proportions } from './pose';

export type HairStyle = 'short-crop' | 'side-part' | 'bun' | 'ponytail' | 'curls' | 'bald';
export type TopKind = 'shirt' | 'blouse' | 'knit' | 'jacket';
export type LowerKind = 'trousers' | 'skirt';

export interface CharacterAppearance {
  readonly height: number;
  /** Torso/shoulder width multiplier, 0.94 … 1.06. */
  readonly build: number;
  readonly skin: string;
  readonly hairStyle: HairStyle;
  readonly hairColor: string;
  readonly top: { readonly kind: TopKind; readonly color: string };
  /** Jacket worn over the top, or null for shirt sleeves. */
  readonly jacket: string | null;
  readonly lower: { readonly kind: LowerKind; readonly color: string };
  readonly shoes: string;
  readonly glasses: boolean;
  readonly facialHair: boolean;
  /** Animation phase 0..1 — desynchronises idles between colleagues. */
  readonly phase: number;
  /** Personal tempo multiplier for working animations. */
  readonly tempo: number;
  readonly proportions: Proportions;
}

const SKIN = ['#f1d5bf', '#e8c1a1', '#d8a47f', '#bb7f5a', '#8f5c40', '#6b452e'] as const;
const HAIR = ['#191817', '#33241b', '#5b3d26', '#8a6540', '#c9b391', '#7a7a7a'] as const;
const TOPS = ['#e9e6df', '#c3d3dd', '#2f7d86', '#3b424a', '#b9b0a2', '#2b3442', '#7d8a76'] as const;
const JACKETS = ['#232a35', '#2e343b', '#3c3a3f', null, null] as const;
const LOWER = ['#22262c', '#343a42', '#2b3038', '#6f6a60'] as const;
const SHOES = ['#141618', '#241f1c', '#3a3631'] as const;

/** FNV-1a — stable across sessions and platforms. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 0..1 seed for an agent, used by the animation engine. */
export function seedFor(agentId: string): number {
  return hashString(agentId) / 0xffffffff;
}

const pick = <T>(list: readonly T[], random: () => number): T =>
  list[Math.min(list.length - 1, Math.floor(random() * list.length))] as T;

const appearanceCache = new Map<string, CharacterAppearance>();

export function appearanceFor(agentId: string): CharacterAppearance {
  const cached = appearanceCache.get(agentId);
  if (cached) return cached;

  const random = seededRandom(hashString(`appearance:${agentId}`));
  const height = 1.62 + random() * 0.24;
  const build = 0.94 + random() * 0.12;
  const hairStyle = pick<HairStyle>(
    ['short-crop', 'side-part', 'bun', 'ponytail', 'curls', 'short-crop', 'side-part', 'bald'],
    random,
  );
  const topKind = pick<TopKind>(['shirt', 'blouse', 'knit', 'shirt', 'jacket'], random);
  const hasJacket = topKind !== 'jacket' ? random() < 0.28 : true;
  const jacketColors = JACKETS.filter(
    (value): value is NonNullable<(typeof JACKETS)[number]> => value !== null,
  );
  const appearance: CharacterAppearance = {
    height,
    build,
    skin: pick(SKIN, random),
    hairStyle,
    // Grey hair reads as seniority; keep it rare.
    hairColor: random() < 0.08 ? HAIR[5] : pick(HAIR.slice(0, 5), random),
    top: { kind: topKind, color: pick(TOPS, random) },
    jacket: hasJacket ? pick(jacketColors, random) : null,
    lower: {
      kind: random() < 0.32 ? 'skirt' : 'trousers',
      color: pick(LOWER, random),
    },
    shoes: pick(SHOES, random),
    glasses: random() < 0.38,
    facialHair: hairStyle !== 'bald' && random() < 0.22,
    phase: random(),
    tempo: 0.92 + random() * 0.16,
    proportions: proportionsFor(height),
  };
  appearanceCache.set(agentId, appearance);
  return appearance;
}
