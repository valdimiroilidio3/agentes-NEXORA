/**
 * Shared material + geometry catalogue.
 *
 * Every mesh in the scene reuses these instances, so the renderer uploads a
 * handful of materials instead of hundreds. Never mutate them per-mesh;
 * variation is expressed through geometry and vertex-free props (scale).
 */
import * as THREE from 'three';

export type MaterialKey =
  | 'concrete'
  | 'concreteDark'
  | 'plaster'
  | 'glass'
  | 'glassPartition'
  | 'metal'
  | 'darkMetal'
  | 'wood'
  | 'woodDark'
  | 'fabric'
  | 'fabricLight'
  | 'carpet'
  | 'stone'
  | 'resin'
  | 'screen'
  | 'light'
  | 'accent'
  | 'white'
  | 'black'
  | 'lawn'
  | 'foliage'
  | 'asphalt'
  | 'paving'
  | 'selection'
  | 'selectionSoft'
  | 'statusActive'
  | 'statusWaiting'
  | 'statusError'
  | 'statusIdle'
  | 'statusOffline';

function standard(
  color: string,
  roughness: number,
  metalness: number,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

export const materials: Record<MaterialKey, THREE.Material> = {
  concrete: standard('#6b7076', 0.88, 0.04),
  concreteDark: standard('#3b4046', 0.9, 0.03),
  plaster: standard('#d6d3cb', 0.95, 0.0),
  glass: new THREE.MeshPhysicalMaterial({
    color: '#bcd6df',
    roughness: 0.06,
    metalness: 0.0,
    transparent: true,
    opacity: 0.24,
    transmission: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
  glassPartition: new THREE.MeshPhysicalMaterial({
    color: '#cfe2e6',
    roughness: 0.08,
    metalness: 0.0,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
  metal: standard('#9aa3ad', 0.34, 0.86),
  darkMetal: standard('#31363c', 0.45, 0.7),
  wood: standard('#8a6647', 0.62, 0.04),
  woodDark: standard('#5a4028', 0.66, 0.03),
  fabric: standard('#3f4a56', 0.96, 0.0),
  fabricLight: standard('#8b939c', 0.94, 0.0),
  carpet: standard('#2c333c', 0.99, 0.0),
  stone: standard('#9c9890', 0.7, 0.05),
  resin: standard('#b5b3ab', 0.42, 0.05),
  screen: standard('#101418', 0.35, 0.2, { emissive: new THREE.Color('#4fb8cf'), emissiveIntensity: 0.6 }),
  light: standard('#fff4e2', 0.4, 0.0, { emissive: new THREE.Color('#ffe7c2'), emissiveIntensity: 1.6 }),
  accent: standard('#54d6e6', 0.4, 0.2, { emissive: new THREE.Color('#2f9fb2'), emissiveIntensity: 0.9 }),
  white: standard('#e6e3dc', 0.82, 0.0),
  black: standard('#15181c', 0.6, 0.3),
  lawn: standard('#2c3a30', 1.0, 0.0),
  foliage: standard('#2f4536', 0.95, 0.0),
  asphalt: standard('#24272b', 0.95, 0.0),
  paving: standard('#4d5157', 0.85, 0.02),
  selection: new THREE.MeshStandardMaterial({
    color: '#54d6e6',
    emissive: new THREE.Color('#2f9fb2'),
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.22,
    roughness: 0.5,
    depthWrite: false,
  }),
  selectionSoft: new THREE.MeshStandardMaterial({
    color: '#9fb3c2',
    emissive: new THREE.Color('#3c5666'),
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.12,
    roughness: 0.6,
    depthWrite: false,
  }),
  statusActive: standard('#54d6e6', 0.4, 0.1, {
    emissive: new THREE.Color('#3fc6dc'),
    emissiveIntensity: 0.9,
  }),
  statusWaiting: standard('#e2b263', 0.4, 0.1, {
    emissive: new THREE.Color('#c58d33'),
    emissiveIntensity: 0.8,
  }),
  statusError: standard('#e58fa6', 0.4, 0.1, {
    emissive: new THREE.Color('#c9566f'),
    emissiveIntensity: 0.9,
  }),
  statusIdle: standard('#6b7783', 0.6, 0.1),
  statusOffline: standard('#3a424b', 0.8, 0.0),
};

/** Single unit cube reused by every box in the scene. */
export const unitBox = new THREE.BoxGeometry(1, 1, 1);
export const unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
export const unitCylinderLow = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
export const unitSphere = new THREE.SphereGeometry(0.5, 18, 14);
export const unitTorus = new THREE.TorusGeometry(0.5, 0.05, 8, 32);
export const unitPlane = new THREE.PlaneGeometry(1, 1);

export function disposeSceneMaterials(): void {
  for (const material of Object.values(materials)) material.dispose();
  unitBox.dispose();
  unitCylinder.dispose();
  unitCylinderLow.dispose();
  unitSphere.dispose();
  unitTorus.dispose();
  unitPlane.dispose();
}
