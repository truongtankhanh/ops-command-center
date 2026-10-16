import { Canvas } from '@react-three/fiber';
import { mapColors } from '../styles/tokens';

/**
 * The WebGL canvas of the 3D twin (ADR-0020). Nothing is drawn yet: the site plan arrives with
 * V2-12.6, the camera with V2-12.9.
 *
 * - `frameloop="demand"`: a frame is drawn only when something asks for one (a moving part, an
 *   easing value, the camera), so an idle scene costs nothing.
 * - `dpr={[1, 1.5]}`: the pixel ratio never exceeds 1.5 (brief § Performance); V2-19.3 steps it down.
 * - `flat`: no tone mapping, so the colours on screen are the token colours.
 *
 * R3F sizes the canvas to its parent, so the parent must have a size (`TwinStage`).
 */
export function TwinCanvas() {
  return (
    <Canvas frameloop="demand" dpr={[1, 1.5]} flat>
      {/* `--surface-0`, a copy kept in step by `scripts/contrast.ts --check` (WebGL cannot read CSS). */}
      <color attach="background" args={[mapColors.ground]} />
    </Canvas>
  );
}
