'use client';

/**
 * Per-character material cache.
 *
 * Materials are keyed by role + colour so a whole workforce shares a bounded
 * set of GPU materials (roughly 25 for 27 agents) instead of one per agent.
 */
import * as THREE from 'three';
import type { CharacterAppearance } from './appearance';
import type { PartMaterial } from './parts';

const cache = new Map<string, THREE.Material>();

function get(key: string, create: () => THREE.Material): THREE.Material {
  const cached = cache.get(key);
  if (cached) return cached;
  const material = create();
  cache.set(key, material);
  return material;
}

const fixed: Record<string, { color: string; roughness: number; metalness: number }> = {
  eye: { color: '#1b1917', roughness: 0.35, metalness: 0.05 },
  metal: { color: '#b6bcc2', roughness: 0.32, metalness: 0.88 },
  dark: { color: '#23262b', roughness: 0.62, metalness: 0.15 },
  white: { color: '#eae7e0', roughness: 0.86, metalness: 0 },
  accent: { color: '#2f7d86', roughness: 0.55, metalness: 0.08 },
};

/** Resolves the colour a role takes for this appearance. */
export function roleColor(role: PartMaterial, app: CharacterAppearance): string {
  switch (role) {
    case 'skin':
      return app.skin;
    case 'hair':
      return app.hairColor;
    case 'top':
      return app.top.color;
    case 'jacket':
      return app.jacket ?? app.top.color;
    case 'lower':
      return app.lower.color;
    case 'shoes':
      return app.shoes;
    default:
      return fixed[role]?.color ?? '#6f747a';
  }
}

export function characterMaterial(role: PartMaterial, app: CharacterAppearance): THREE.Material {
  const color = roleColor(role, app);
  if (role === 'glasses') {
    return get(`glasses`, () =>
      new THREE.MeshPhysicalMaterial({
        color: '#cfe0e4',
        roughness: 0.08,
        metalness: 0,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    );
  }
  const preset = fixed[role];
  const roughness =
    role === 'skin' ? 0.72 : role === 'hair' ? 0.78 : role === 'shoes' ? 0.4 : (preset?.roughness ?? 0.82);
  const metalness = preset?.metalness ?? 0;
  return get(`${role}:${color}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness }),
  );
}

export function characterMaterialCount(): number {
  return cache.size;
}

export function disposeCharacterMaterials(): void {
  for (const material of cache.values()) material.dispose();
  cache.clear();
}
