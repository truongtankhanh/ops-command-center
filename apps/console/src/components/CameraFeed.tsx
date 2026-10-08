import type { Camera, StreamDescriptor } from '@occ/contracts';
import { type ReactNode, useEffect, useRef } from 'react';
import { useStream } from '../api/queries';
import { feedState } from '../lib/cameras';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { type Glyph, cameraIcon } from '../ui/icons';
import { Skeleton } from '../ui/Skeleton';
import styles from './CameraFeed.module.css';

/** Canvas size of a simulated picture: a strip / sheet tile, or the larger viewer. */
export type FeedResolution = 'tile' | 'viewer';

const CANVAS: Record<FeedResolution, { width: number; height: number }> = {
  tile: { width: 320, height: 180 },
  viewer: { width: 640, height: 360 },
};

/** The scene is laid out on this grid, then scaled to the canvas, so a seed looks the same anywhere. */
const SCENE_WIDTH = 320;
const SCENE_HEIGHT = 180;

/**
 * A camera's picture, or why there is none: the camera is offline, its stream could not be
 * resolved, or it is still being resolved. Fills its positioned parent; the chrome around it (LIVE,
 * names, time) belongs to the caller.
 */
export function CameraFeed({
  camera,
  resolution = 'tile',
}: {
  camera: Camera;
  resolution?: FeedResolution;
}) {
  const query = useStream(camera);

  switch (feedState(camera.online, query)) {
    case 'offline':
      return <Notice glyph={cameraIcon(false)} title="No signal" detail="Camera offline" />;
    case 'unavailable':
      return (
        <Notice
          glyph={cameraIcon(false)}
          title="Stream unavailable"
          action={
            <Button
              size="sm"
              variant="ghost"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          }
        />
      );
    case 'pending':
      return (
        <div className={styles.feed}>
          <Skeleton className={styles.pending} />
        </div>
      );
    case 'stream':
      return <StreamView stream={query.data!} resolution={resolution} />;
  }
}

/**
 * Renders a camera by its StreamDescriptor (ADR-0002) — the only place that looks at its `kind`.
 * The view knows nothing about where video comes from, only how to draw each kind.
 */
function StreamView({
  stream,
  resolution,
}: {
  stream: StreamDescriptor;
  resolution: FeedResolution;
}) {
  switch (stream.kind) {
    case 'mock':
      return <MockFeed seed={stream.seed} {...CANVAS[resolution]} />;
    case 'hls':
    case 'webrtc':
      // Real players arrive with MediaMTX in M2 (roadmap OCC-16).
      return (
        <Notice
          glyph={cameraIcon(true)}
          title="Live player arrives in M2"
          detail="HLS / WebRTC playback is not built yet"
        />
      );
  }
}

/** Frame 06's "no picture" state: stripes, a glyph, a title and a reason or an action. */
function Notice({
  glyph,
  title,
  detail,
  action,
}: {
  glyph: Glyph;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className={`${styles.feed} ${styles.notice}`}>
      <Icon glyph={glyph} size={22} />
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
      {action}
    </div>
  );
}

/** Synthetic feed: a still "scene" generated from the seed, with sensor grain. */
function MockFeed({ seed, width, height }: { seed: number; width: number; height: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = usePrefersReducedMotion();

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d', { willReadFrequently: true });
    if (!el || !ctx) return;

    el.width = width;
    el.height = height;
    const scene = buildScene(mulberry32(seed));

    const draw = () => {
      ctx.drawImage(scene, 0, 0, width, height);
      // Sensor grain
      const grain = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < grain.data.length; i += 16) {
        const n = (Math.random() - 0.5) * 22;
        grain.data[i] = grain.data[i]! + n;
        grain.data[i + 1] = grain.data[i + 1]! + n;
        grain.data[i + 2] = grain.data[i + 2]! + n;
      }
      ctx.putImageData(grain, 0, 0);
    };
    draw();
    if (still) return;
    const timer = window.setInterval(draw, 120);
    return () => window.clearInterval(timer);
  }, [seed, width, height, still]);

  return (
    <div className={styles.feed}>
      <canvas ref={canvas} aria-label="Simulated camera feed" role="img" />
    </div>
  );
}

/** A plausible fixed-camera view: ground plane, a few building blocks, light falloff. */
function buildScene(random: () => number): HTMLCanvasElement {
  const width = SCENE_WIDTH;
  const height = SCENE_HEIGHT;
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
