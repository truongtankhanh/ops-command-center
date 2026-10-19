import type { Object3D } from 'three';
import type { AssetPose } from '../lib/twinPlacement';

/** One asset's copy of its class's model, made by `Equipment` and moved by `useBoundParts`. */
export interface ModelInstance {
  assetCode: string;
  object: Object3D;
  pose: AssetPose;
}

interface AssetModelProps {
  instances: readonly ModelInstance[];
}

/**
 * The models in the scene (V2-14.7, frames 03 and 08): each instance at its asset's pose, its base on
 * `pose.y`, centred on `pose.x`, `pose.z` and turned by `pose.rotationY`. It only places what it is given:
 * `Equipment` makes the copies (a copy shares the template's geometry and materials, so a class costs its file
 * once however many assets stand in it) and hands the same objects to `useBoundParts`, which moves their bound
 * parts. Two owners of one object would be two places to get its pose wrong.
 *
 * The objects are `<primitive>`s: R3F does not dispose what it is handed that way, which is right here, because
 * the template owns the geometry and `useClassModels` frees it with the stage.
 */
export function AssetModel({ instances }: AssetModelProps) {
  return (
    <>
      {instances.map(({ assetCode, object, pose }) => (
        <primitive
          key={assetCode}
          object={object}
          position={[pose.x, pose.y, pose.z]}
          rotation-y={pose.rotationY}
        />
      ))}
    </>
  );
}
