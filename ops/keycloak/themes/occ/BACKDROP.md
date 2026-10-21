# The sign-in backdrop

The `occ` login theme stands on a short looping video of a stylised campus and a poster image
(`login/resources/img/campus-loop.webm`, `campus-poster.webp`). Both are made by one script, so they can be
remade: [`ops/sign-in-backdrop/render.ts`](../../../sign-in-backdrop/render.ts). Why it is built this way is in ADR-0010
("Settled in V2-20.1") and the brief's § Sign-in.

## What it must never contain

The sign-in page is public. The picture shows **shapes only**: no label, camera, incident, asset or reading, and
nothing taken from a site plan or from the demo seed. The campus is invented in the script (about a dozen
buildings, a ring road, a lake, a sports field, two car parks, rows of trees). The renderer has no way to draw
text or glyphs, which is the point of making it this way.

## What it is

|         | Value                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| Loop    | 1280 × 720, 24 fps, 960 frames = 40 s, VP9 in WebM, no audio                                                  |
| Poster  | 1920 × 1080 WebP; it is the loop's first frame, so there is no pop when the video starts                      |
| Camera  | tilt 58° from vertical, field of view 30°, 490 m from the target, from the south-east (yaw 30° at the start)  |
| Turn    | 2° a second at constant speed: 30° → 50° → 10° → 30°, so the loop closes on its first frame, in direction too |
| Light   | one key light from the west-south-west, fixed in the world, so faces change tone as the camera turns          |
| Palette | the twin's neutrals from `apps/console/src/styles/tokens.css` (`--tw-*`), a copy held in the script           |
| Budget  | loop ≤ 1.5 MB, poster ≤ 150 KB (V2-20.1); built: about 0.5 MB and 32 KB                                       |

The page puts `rgb(12 24 33 / 0.55)` over it, so the script renders about 25 % brighter than the tokens (`GAIN`).
Under `prefers-reduced-motion`, and behind the console's own sign-in states, the poster is used alone.

The turn is a sweep and back, not a full circle: a full turn at 2° a second is 180 s, which does not fit the
budget. The reversal happens twice in 40 s, at 2° a second, under the shade.

## Remaking it

The script lives beside `ops/model-tools`, not under `ops/keycloak`: Compose mounts that whole folder as Keycloak's realm
import directory, and a `package.json` there is not something Keycloak should meet.

Needs Node 24, `ffmpeg` (with `libvpx-vp9`) and `cwebp` on the PATH; nothing is installed from npm.

```bash
nice node ops/sign-in-backdrop/render.ts            # loop and poster, about 40 s on a laptop
node ops/sign-in-backdrop/render.ts --poster        # the poster only, to look at the scene
```

`BACKDROP_CRF` (default 30, lower is sharper and larger) and `BACKDROP_POSTER_Q` (default 90) trade size for
quality.

Output is deterministic (a seeded generator places the trees), so a change in the files means a change in the
script or in the encoder's version.

## Looked at

Frames at 0, 10, 30 s and the poster, by eye on 2026-10-21: no text, no glyph, buildings and roads in the twin's
blues, the sort order holds at yaw 10° and 50°. A faint banding shows in the dark vignette at CRF 30; the shade
mostly hides it; seen behind the page on 2026-10-21 (V2-20.5), it still shows as faint rings in the top third of the window and is not distracting.
