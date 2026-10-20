# Equipment models

The 3D models of the console's twin, one `.glb` per equipment class. The console's nginx serves this directory at
`/models/` and nothing else in it: only files named `<class>.<12 hex>.glb` are served, and this README is not (it
answers `404`, like any other name). The demo's two files (`cooling_tower`, `standby_generator`) are placeholders
that `pnpm models:standins` generates; a real model replaces a placeholder under a new name. A real deployment
mounts its own directory at `/usr/share/nginx/models`, see the Compose paragraphs of the [root README](../../README.md).

This guide is for whoever makes a model (a vendor, or the next person adding a class) and for whoever accepts one.

## The contract

The rules are in the design brief's [Model contract](../../docs/design/v2/brief.md) (budgets, node naming and
hierarchy, pivots, units, `extras`) and in [ADR-0020](../../docs/adr/0020-digital-twin-rendering-and-model-pipeline.md)
(budgets, serving, hashing). They are not repeated here. The executable form is `pnpm models:check`, whose
constants are at the top of [`ops/model-tools/rules.ts`](../model-tools/rules.ts): when this guide and the check
disagree, the check is what rejects the file, so read it. Every failure prints one line,
`ops/models/<file>: <rule>: <detail>`, with the measured value.

What the check holds a file to, beyond what the brief's tables say:

- **Name:** `<class code>.<first 12 hex of the file's SHA-256>.glb`, the class being an `asset_class.code` known to
  the simulator's catalogue (`ops/telemetry-sim/catalogue.json`), and no other file in this directory but this README.
- **Nodes:** one top-level node named for the class in PascalCase (`cooling_tower` → `CoolingTower`) and, optionally,
  its lower level of detail `<Root>_LOD1` beside it; node names unique in the file.
- **Materials:** at most four, each named from the shared library: `Part`, `Steel`, `Concrete`, `Rail`, `Screen`,
  `Blade`, `Hub`, `Xray`. The console replaces an imported material with its own of that name, so the name is what
  counts, not the colour.
- **Bindings:** a node that moves or changes with a reading carries `extras` with `bind` (a `telemetry_point.key` of
  the class), `motion` (`spin`, `turn`, `slide` or `tint`), for the first three an `axis` (`x`, `y` or `z`) and a
  `range` `[min, max]`, and optionally a `label` (the word the inspector shows). `tint` has no axis or range. No other
  key is allowed on a bound node, so a misspelt `bnd` fails instead of binding nothing.
- **Levels of detail:** the triangle budget counts the class root only; `<Root>_LOD1` has no `extras` and at most a
  quarter of the root's triangles.
- **Geometry and textures:** Meshopt-compressed geometry (no Draco), textures KTX2, at most 1024 on a side and three
  per material, at most 1,500,000 bytes.

## Making a model

Model in your tool of choice (Blender, or any DCC that exports glTF 2.0) to the brief: +Y up, 1 unit = 1 m, the origin
at the centre of the asset's footprint on the ground, each moving part's pivot on its own axis of motion, parts named
by their role. Export one `.glb`. Then optimise it with the commands below, which
[`gltf-transform`](https://gltf-transform.dev/cli) provides. The check only looks at the result; how you get there is
yours.

### Tools

```bash
npm install --global @gltf-transform/cli
```

For textures you also need `toktx` from [KTX-Software](https://github.com/KhronosGroup/KTX-Software/releases) on
your `PATH`; a model without textures does not.

### Pipeline

Run the commands one by one, each writing a new file, and keep the earlier ones until the check passes. They keep the
named nodes, their pivots and their `extras` as the export wrote them; only unused data (and empty leaf nodes) is
dropped.

```bash
gltf-transform validate export.glb                      # the file is valid glTF
gltf-transform dedup export.glb 1-dedup.glb             # duplicate accessors, materials, meshes, textures
gltf-transform weld 1-dedup.glb 2-weld.glb              # merge identical vertices
# only if the model has textures (PNG or JPEG in the export):
gltf-transform resize 2-weld.glb 3-resize.glb --width 1024 --height 1024
gltf-transform etc1s 3-resize.glb 4-ktx2.glb            # KTX2; use `uastc` for normal maps (needs toktx)
gltf-transform meshopt 4-ktx2.glb model.glb             # Meshopt-compress the geometry
```

Without textures, skip `resize` and `etc1s`/`uastc` and feed `2-weld.glb` to `meshopt`.

**Do not run `gltf-transform optimize`.** Its defaults flatten the scene graph and join meshes, which erases the
named nodes, their pivots and their `extras`: on a test file it left one node of four.

`gltf-transform inspect model.glb` prints, per mesh, its triangles (`glPrimitives`) and how many nodes use it, then the
materials, the textures and the scene's bounding box; use it to see where a budget is spent.

### The lower level of detail

`<Root>_LOD1` is a top-level node beside the root, with no `extras`, built from a simplified copy of the root's
geometry at a quarter of its triangles or less. Make it in your tool (a Decimate modifier in Blender). The CLI's
`simplify` works on every mesh of a file, so it cannot be pointed at one node: use it on a copy that holds only the
root, `gltf-transform simplify root.glb lod1.glb --ratio 0.25 --error 0.05` (the ratio is of vertices, so check the
triangle count), then bring those meshes in as `<Root>_LOD1`.

The console draws `<Root>_LOD1` instead of the root once the model's bounding sphere is below 5 % of the screen's height
(about 43 times its radius from the camera), as a static silhouette in the console's materials: it has no bound parts, so
the motion and the state tint of the parts are not shown there. Keep its outline close to the root's, since the swap is
the only place the difference shows.

### Name, check, deliver

The name carries the hash of the final bytes, so name the file **after** its last change; changing a single byte means
a new name. The class is the part before the first dot.

```bash
hash=$(shasum -a 256 model.glb | cut -c1-12)             # Linux: sha256sum model.glb | cut -c1-12
mv model.glb "ops/models/cooling_tower.$hash.glb"
pnpm models:check
```

`pnpm models:check` prints `models:check: N model file(s) conform` or one line per failed rule. Fix the model, run the
pipeline again from the export and rename with the new hash. Never edit a file that is already named: a replacement is
a new name, never an edit, so no cache can be stale.

## Accepting a delivery

Whoever receives a model does this before it is merged or mounted:

1. **Run the check.** `pnpm models:check` passes with no waiver, and `gltf-transform validate` reports no error.
2. **Move every bound part.** Open the file in a glTF viewer or import it in Blender, and for each node with `extras`
   move it along its `axis` over its `range` (rotate for `turn` and `spin`, translate for `slide`): it must move as
   a real part would, about its own pivot, not about the model's origin.
3. **Confirm pivots and units.** The origin is at the centre of the footprint on the ground, +Y is up, one unit is a
   metre; the model is not mirrored or scaled by a stray node transform.
4. **Confirm the bounds.** The bounding box from `gltf-transform inspect` matches the class's `footprint_m` (width ×
   depth × height, in [`asset-classes.md`](../../docs/design/v2/asset-classes.md)) or the dimensions the tech lead
   agreed with the vendor; if they differ on purpose, `footprint_m` changes by a reviewed data change, not by the
   model.
5. **Confirm every part is bound as intended.** Each `bind` is the point the part is meant to show, and the `label`
   reads right in the inspector.
6. **Confirm it loads in the console.** The 3D view does not load equipment models yet; once it does, set the class's
   `model_key` in a development database and check the model is drawn and its parts move with the readings.

## Adding a class

A class is data, and its model is a file:

1. **The class and its points** exist as an `asset_class` with its `telemetry_point` rows, and in the simulator's
   catalogue (`ops/telemetry-sim/catalogue.json`, kept in step with the seed by a spec), which is where
   `pnpm models:check` reads the class codes and the keys a `bind` may use. A class the catalogue does not know is
   rejected as unknown.
2. **The model** is made as above, named for the class, with `bind` keys from that class's points.
3. **The file** goes in this directory (or the deployment's own), after `pnpm models:check`.
4. **`asset_class.model_key`** is set to the file name; the API then returns the asset's `modelUrl` as
   `/models/<model_key>`. Mount the file before you set the key: a key with no file behind it is a `404`.

By design (ADR-0020) the console builds a model's bindings from its `extras`, so a new class needs a model and data,
not console code.

## The demo's placeholders

`pnpm models:standins` regenerates `cooling_tower` and `standby_generator` (boxes and cylinders sized to the
classes' footprints, with the real node trees, pivots and `extras`). The same code gives the same bytes; if its
output changes, it writes a new file name and lists the old file as stale, which you delete by hand. A vendor's file
replaces a placeholder the same way: add the new file, point `model_key` at it, delete the old one.
