# Cameras

### List cameras

<!-- steel:endpoint GET /api/cameras | query: zoneId? | returns: Camera[] | auth: bearer -->

`GET /api/cameras` · Status: current

Cameras ordered by code, optionally limited to one zone.

| Query    | Type   | Notes                          |
| -------- | ------ | ------------------------------ |
| `zoneId` | `uuid` | optional; must be a valid UUID |

**200** — `Camera[]` (`id`, `code`, `name`, `zoneId`, `position: [lng, lat]`, `online`, `fieldOfView`)
**400** — `zoneId` is not a UUID
**401** — missing or invalid bearer token
**403** — the token has no role

`fieldOfView` is what the camera sees, a circular sector from `position`, or `null` when its orientation is not known
(draw no view then) ([ADR-0017](../adr/0017-site-plan-as-data.md)):

| Field     | Type     | Notes                                                         |
| --------- | -------- | ------------------------------------------------------------- |
| `heading` | `number` | centre line, degrees clockwise from true north; `0 ≤ h < 360` |
| `angle`   | `number` | width of the view in degrees; `0 < a ≤ 360`                   |
| `range`   | `number` | how far the camera sees, in metres; `> 0`                     |

A client must also read a missing `fieldOfView` as `null`: an API from before this field omits it.

Source: `apps/api/src/cameras/cameras.controller.ts:35`

### Resolve a camera's stream

<!-- steel:endpoint GET /api/cameras/:id/stream | params: id | returns: StreamDescriptor | auth: bearer -->

`GET /api/cameras/:id/stream` · Status: current

How a client should render this camera. The answer comes from the configured camera source
(`CAMERA_SOURCE`), so clients never build stream URLs themselves.

| Param | Type   |
| ----- | ------ |
| `id`  | `uuid` |

**200** — `StreamDescriptor`, one of:

| `kind`   | Extra fields           | When                                                 |
| -------- | ---------------------- | ---------------------------------------------------- |
| `mock`   | `seed: number`         | `CAMERA_SOURCE=mock` — render a synthetic feed       |
| `hls`    | `url` (`…/index.m3u8`) | `CAMERA_SOURCE=mediamtx`, `MEDIAMTX_PROTOCOL=hls`    |
| `webrtc` | `url` (`…/whep`)       | `CAMERA_SOURCE=mediamtx`, `MEDIAMTX_PROTOCOL=webrtc` |

Every variant also has `cameraId` and `label`.

**401** — missing or invalid bearer token
**403** — the token has no role
**404** — unknown camera

Source: `apps/api/src/cameras/cameras.controller.ts:44`
