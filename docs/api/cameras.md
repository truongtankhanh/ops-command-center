# Cameras

### List cameras

<!-- steel:endpoint GET /api/cameras | query: zoneId? | returns: Camera[] | auth: none -->

`GET /api/cameras` · Status: current

Cameras ordered by code, optionally limited to one zone.

| Query    | Type   | Notes                          |
| -------- | ------ | ------------------------------ |
| `zoneId` | `uuid` | optional; must be a valid UUID |

**200** — `Camera[]` (`id`, `code`, `name`, `zoneId`, `position: [lng, lat]`, `online`)
**400** — `zoneId` is not a UUID

Source: `apps/api/src/cameras/cameras.controller.ts:13`

### Resolve a camera's stream

<!-- steel:endpoint GET /api/cameras/:id/stream | params: id | returns: StreamDescriptor | auth: none -->

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

**404** — unknown camera

Source: `apps/api/src/cameras/cameras.controller.ts:21`
