import type { Camera, StreamDescriptor } from '@occ/contracts';
import { useEffect, useRef } from 'react';
import { useStream } from '../api/queries';

/**
 * Renders a camera by its StreamDescriptor (ADR-0002). The tile knows nothing about
 * where video comes from — only how to draw each descriptor kind.
 */
export function CameraTile({ camera }: { camera: Camera }) {
  const { data: stream, isError } = useStream(camera.id);

  return (
    <figure className="camera-tile" style={{ margin: 0 }}>
      {!camera.online ? (
        <div className="camera-tile-offline">No signal</div>
      ) : isError ? (
        <div className="camera-tile-offline">Stream unavailable</div>
      ) : stream ? (
        <StreamView stream={stream} />
      ) : null}
      <figcaption className="camera-tile-label">
        <span>{camera.name}</span>
        <span className="muted">{camera.code}</span>
      </figcaption>
    </figure>
  );
}

function StreamView({ stream }: { stream: StreamDescriptor }) {
  switch (stream.kind) {
    case 'mock':
      return <MockFeed seed={stream.seed} />;
    case 'hls':
    case 'webrtc':
      // Real players arrive with MediaMTX in M2 (roadmap OCC-16).
      return <div className="camera-tile-offline">Live player arrives in M2</div>;
  }
}

/** Synthetic feed: a still "scene" generated from the seed, with sensor grain and a timestamp. */
function MockFeed({ seed }: { seed: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d', { willReadFrequently: true });
    if (!el || !ctx) return;

    const width = (el.width = 320);
    const height = (el.height = 180);
    const random = mulberry32(seed);
    const scene = buildScene(random, width, height);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const draw = () => {
      ctx.drawImage(scene, 0, 0);
      // Sensor grain
      const grain = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < grain.data.length; i += 16) {
        const n = (Math.random() - 0.5) * 22;
        grain.data[i] = grain.data[i]! + n;
        grain.data[i + 1] = grain.data[i + 1]! + n;
        grain.data[i + 2] = grain.data[i + 2]! + n;
      }
      ctx.putImageData(grain, 0, 0);
      ctx.fillStyle = 'rgba(220,231,238,0.85)';
      ctx.font = '11px "Barlow Semi Condensed", sans-serif';
      ctx.fillText(new Date().toLocaleTimeString([], { hour12: false }), 8, 16);
    };
    draw();
    if (still) return;
    const timer = window.setInterval(draw, 120);
    return () => window.clearInterval(timer);
  }, [seed]);

  return <canvas ref={canvas} aria-label="Simulated camera feed" role="img" />;
}

/** A plausible fixed-camera view: ground plane, a few building blocks, light falloff. */
function buildScene(random: () => number, width: number, height: number): HTMLCanvasElement {
  const scene = document.createElement('canvas');
  scene.width = width;
  scene.height = height;
  const ctx = scene.getContext('2d')!;
  const horizon = height * (0.35 + random() * 0.2);
  const hue = 190 + random() * 30;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, `hsl(${hue} 18% 16%)`);
  sky.addColorStop(1, `hsl(${hue} 14% 26%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon);

  const ground = ctx.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, `hsl(${hue} 8% 22%)`);
  ground.addColorStop(1, `hsl(${hue} 6% 12%)`);
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, width, height - horizon);

  for (let i = 0; i < 5; i++) {
    const w = 30 + random() * 70;
    const h = 20 + random() * 60;
    const x = random() * (width - w);
    ctx.fillStyle = `hsl(${hue} 10% ${14 + random() * 12}%)`;
    ctx.fillRect(x, horizon - h, w, h);
    ctx.fillStyle = `hsl(45 60% ${50 + random() * 20}% / 0.5)`;
    for (let y = horizon - h + 6; y < horizon - 6; y += 10) {
      for (let wx = x + 5; wx < x + w - 6; wx += 9) if (random() > 0.55) ctx.fillRect(wx, y, 4, 4);
    }
  }

  // Lane / path lines converging to the horizon
  ctx.strokeStyle = `hsl(${hue} 10% 40% / 0.5)`;
  ctx.lineWidth = 2;
  const vanishing = width * (0.3 + random() * 0.4);
  for (const x of [width * 0.1, width * 0.9]) {
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(vanishing, horizon);
    ctx.stroke();
  }

  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    height / 3,
    width / 2,
    height / 2,
    width / 1.2,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  return scene;
}

/** Small seeded PRNG so each camera always shows the same scene. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
