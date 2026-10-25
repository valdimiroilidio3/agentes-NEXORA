'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { materials, unitBox } from './materials';
import type { MaterialKey } from './materials';
import type { BoxSpec } from './architecture';

interface Group {
  readonly key: string;
  readonly material: MaterialKey;
  readonly size: readonly [number, number, number];
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly items: readonly BoxSpec[];
}

const INSTANCE_THRESHOLD = 5;

function groupSpecs(specs: readonly BoxSpec[]): Group[] {
  const groups = new Map<string, Group>();
  for (const spec of specs) {
    const castShadow = spec.castShadow ?? false;
    const receiveShadow = spec.receiveShadow ?? false;
    const key = `${spec.material}|${spec.size.map((value) => Math.round(value * 1000)).join('x')}|${castShadow}|${receiveShadow}`;
    const existing = groups.get(key);
    if (existing) {
      (existing.items as BoxSpec[]).push(spec);
    } else {
      groups.set(key, {
        key,
        material: spec.material,
        size: spec.size,
        castShadow,
        receiveShadow,
        items: [spec],
      });
    }
  }
  return [...groups.values()];
}

/**
 * Repeated identical boxes (mullions, fins, spandrels, columns, door frames)
 * collapse into a single InstancedMesh, which keeps the draw-call count flat
 * as the building grows. Unique boxes stay as individual meshes.
 */
function InstancedGroup({ group }: { group: Group }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(group.size[0], group.size[1], group.size[2]);
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();

    group.items.forEach((item, index) => {
      position.set(item.position[0], item.position[1], item.position[2]);
      euler.set(0, item.rotationY ?? 0, 0);
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
  }, [group]);

  return (
    <instancedMesh
      ref={ref}
      args={[unitBox, materials[group.material], group.items.length]}
      castShadow={group.castShadow}
      receiveShadow={group.receiveShadow}
    />
  );
}

export function SceneBoxes({ specs }: { specs: readonly BoxSpec[] }) {
  const groups = useMemo(() => groupSpecs(specs), [specs]);

  return (
    <>
      {groups.map((group) =>
        group.items.length >= INSTANCE_THRESHOLD ? (
          <InstancedGroup key={group.key} group={group} />
        ) : (
          group.items.map((spec) => (
            <mesh
              key={spec.id}
              geometry={unitBox}
              material={materials[spec.material]}
              position={[spec.position[0], spec.position[1], spec.position[2]]}
              scale={[spec.size[0], spec.size[1], spec.size[2]]}
              rotation-y={spec.rotationY ?? 0}
              castShadow={spec.castShadow ?? false}
              receiveShadow={spec.receiveShadow ?? false}
            />
          ))
        ),
      )}
    </>
  );
}

/** Draw-call surface of a spec list, used by tests and the perf readout. */
export function drawCallCount(specs: readonly BoxSpec[]): number {
  return groupSpecs(specs).reduce(
    (total, group) => total + (group.items.length >= INSTANCE_THRESHOLD ? 1 : group.items.length),
    0,
  );
}
