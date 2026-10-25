'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

interface LabelOptions {
  readonly foreground?: string;
  readonly background?: string;
  readonly accent?: string;
  readonly sub?: string;
}

function createTexture(text: string, options: LabelOptions = {}): THREE.CanvasTexture {
  const key = `${text}|${options.sub ?? ''}|${options.foreground ?? ''}|${options.accent ?? ''}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const width = 512;
  const height = 160;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = options.background ?? 'rgba(10, 14, 18, 0.82)';
  const radius = 22;
  ctx.beginPath();
  ctx.roundRect(8, 8, width - 16, height - 16, radius);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (options.accent) {
    ctx.fillStyle = options.accent;
    ctx.beginPath();
    ctx.roundRect(28, 34, 8, height - 68, 4);
    ctx.fill();
  }

  ctx.fillStyle = options.foreground ?? '#eaf2f7';
  ctx.font = '600 46px Inter, "Helvetica Neue", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.length > 26 ? `${text.slice(0, 25)}…` : text, 56, options.sub ? 62 : height / 2);

  if (options.sub) {
    ctx.fillStyle = 'rgba(214, 228, 238, 0.62)';
    ctx.font = '400 30px Inter, "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(options.sub, 56, 110);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

export function LabelSprite({
  text,
  sub,
  position,
  accent,
  scale = 1,
  visible = true,
}: {
  text: string;
  sub?: string;
  position: readonly [number, number, number];
  accent?: string;
  scale?: number;
  visible?: boolean;
}) {
  const texture = useMemo(
    () => createTexture(text, { accent, ...(sub ? { sub } : {}) }),
    [text, sub, accent],
  );
  const width = 3.1 * scale;
  const height = (width / 512) * 160;
  if (!visible) return null;
  return (
    <sprite position={[position[0], position[1], position[2]]} scale={[width, height, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

/** Illuminated building sign above the entrance canopy. */
export function FacadeSign({ x, z, y }: { x: number; z: number; y: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e9f4f8';
    ctx.font = '600 132px Inter, "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEXORA', canvas.width / 2, 112);
    ctx.fillStyle = 'rgba(120, 210, 226, 0.85)';
    ctx.font = '400 34px Inter, "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('H E A D Q U A R T E R S', canvas.width / 2, 200);
    const canvasTexture = new THREE.CanvasTexture(canvas);
    canvasTexture.colorSpace = THREE.SRGBColorSpace;
    canvasTexture.anisotropy = 8;
    return canvasTexture;
  }, []);

  return (
    <mesh position={[x, y, z]} rotation-y={Math.PI}>
      <planeGeometry args={[7.4, 1.85]} />
      <meshStandardMaterial
        map={texture}
        transparent
        emissiveMap={texture}
        emissive={'#cfe9f2'}
        emissiveIntensity={0.5}
        toneMapped={false}
      />
    </mesh>
  );
}
