# Assets

The equipment catalogue of the site: cooling towers, generators, air handlers, sensors. An asset has a class
(what kind of equipment it is and what it measures), a place, and the points its class reports. These routes are
read-only: nothing in the API writes an asset, a point or a rule, and there is no route that commands a device
([ADR-0018](../adr/0018-assets-and-telemetry-as-domain-data.md)). Readings are not here: they arrive on the
telemetry channel, and their history has its own route.

### List assets

<!-- steel:endpoint GET /api/assets | returns: Asset[] | auth: bearer -->

`GET /api/assets` · Status: current

Every asset of the site ordered by `code`, each with its class, position and headline points. Reference data: a
client may cache it for the session. There is no pagination; the catalogue is a few dozen rows.

**200** — `Asset[]`
**401** — missing or invalid bearer token
**403** — the token has no role
**429** — rate limit exceeded; see `Retry-After`

| Field        | Type                 | Notes                                                                           |
| ------------ | -------------------- | ------------------------------------------------------------------------------- |
| `id`         | `uuid`               |                                                                                 |
| `code`       | `string`             | the operators' tag, e.g. `CT-01`; the key of the detail route                   |
| `name`       | `string`             | e.g. `Cooling tower 1`                                                          |
| `class`      | object, see below    | what kind of equipment this is                                                  |
| `zoneId`     | `uuid`               | the zone the asset stands in, as in [zones.md](zones.md)                        |
| `position`   | `[lng, lat]`         |                                                                                 |
| `elevationM` | `number`             | metres of the asset's base above ground, `≥ 0`; a roof is the building's height |
| `headingDeg` | `number`             | degrees clockwise from true north, `0 ≤ h < 360`; the direction a model faces   |
| `headline`   | `Point[]`, see below | the class's headline points ordered by rank, at most two; `[]` if it has none   |

`class`:

| Field        | Type               | Notes                                                                                 |
| ------------ | ------------------ | ------------------------------------------------------------------------------------- |
| `id`         | `uuid`             |                                                                                       |
| `code`       | `string`           | lower snake case, e.g. `cooling_tower`                                                |
| `name`       | `string`           |                                                                                       |
| `modelUrl`   | `string` or `null` | `/models/<file>` of the class's 3D model; `null`: draw a box from `footprintM`        |
| `footprintM` | object             | `width`, `depth`, `height` in metres, each `> 0`: the box a placeholder is drawn from |

`headline` points are the same shape as `points` of the detail route, below.

Source: `apps/api/src/assets/assets.controller.ts:37`

### Get an asset

<!-- steel:endpoint GET /api/assets/:code | params: code | returns: AssetDetail | auth: bearer -->

`GET /api/assets/:code` · Status: current

One asset by its code, with **all** the points of its class and the threshold rules that apply to it. It is
everything the list returns, plus `points` and `rules`.

| Param  | Type     | Notes                                                                           |
| ------ | -------- | ------------------------------------------------------------------------------- |
| `code` | `string` | `^[A-Z]{2,4}-[A-Z0-9]{2,6}$`, case-sensitive: `CT-01` is a code, `ct-01` is not |

**200** — `AssetDetail`
**400** — `code` is not an asset tag (`message` is a list with the reason)
**401** — missing or invalid bearer token
**403** — the token has no role
**404** — no asset has this code (`Asset XX-99 was not found`)
**429** — rate limit exceeded; see `Retry-After`

Fields: those of the list, and

| Field    | Type      | Notes                                                          |
| -------- | --------- | -------------------------------------------------------------- |
| `points` | `Point[]` | every point of the class, headline or not; see the order below |
| `rules`  | `Rule[]`  | the enabled rules that apply to this asset; see below          |

`Point`:

| Field               | Type                        | Notes                                                                               |
| ------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| `key`               | `string`                    | camelCase, unique within the class, e.g. `motorTempC`                               |
| `label`             | `string`                    | e.g. `Motor temperature`                                                            |
| `unit`              | `string` or `null`          | `null` for a boolean or an enum                                                     |
| `kind`              | `number`, `boolean`, `enum` |                                                                                     |
| `min`, `max`        | `number` or `null`          | the valid range of a `number` point; a reading outside it is dropped, never clamped |
| `enumValues`        | `string[]` or `null`        | the values an `enum` point can take; `null` for every other kind                    |
| `expectedIntervalS` | `number`                    | how often a device sends the point, `> 0`; judge freshness against it               |
| `headline`          | `1`, `2` or `null`          | rank among the class's headline points; `null`: not a headline                      |

`Rule`:

| Field          | Type             | Notes                                                                     |
| -------------- | ---------------- | ------------------------------------------------------------------------- |
| `name`         | `string`         | e.g. `Motor over-temperature`                                             |
| `key`          | `string`         | the `key` of one of the asset's points                                    |
| `comparator`   | `above`, `below` | which side of `limit` is a breach                                         |
| `limit`        | `number`         | the reading that is a breach once passed; a boolean point uses `0.5`      |
| `clear`        | `number`         | the level a reading must pass back before the rule can raise again        |
| `forS`         | `number`         | seconds a breach must last before it raises an incident, `≥ 0`            |
| `severity`     | enum             | `low`, `medium`, `high`, `critical`                                       |
| `incidentType` | enum             | the `facilities` or `environment` incident type a sustained breach raises |

`clear` is on the safe side of `limit`: `clear ≤ limit` for `above`, `clear ≥ limit` for `below`.

#### Order

- `points`: the headline points first, by rank, then the others by `key`.
- `rules`: by `name`.
- The list is by `code`.

Orders are by code point (`B` before `a`), the same on every replica.

#### Which rules apply

A class defines rules for every asset of the class. An asset can have a rule of its own with the same `name`, and
that rule **replaces** the class rule for that asset only. A disabled rule is left out of `rules`. Replacing comes
first, so an asset's own rule that is disabled turns that rule **off for that asset**: the class rule does not come
back for it, and every other asset of the class keeps it.

A client therefore never sees which rules the class defines, nor whether a rule was replaced or disabled: `rules`
is what is in force for this asset.

Source: `apps/api/src/assets/assets.controller.ts:44`

### Notes

- **Roles.** Any known role reads both routes (`operator`, `supervisor`, `technician`, `viewer`); a token with none
  gets `403`. Authorization runs before validation: a token with no role gets `403` even for a malformed code
  (see [Conventions](README.md#conventions-that-apply-to-every-endpoint)).
- **No writes.** `POST`, `PUT`, `PATCH` and `DELETE` on `/api/assets` find no route. Equipment and rules are
  changed by a reviewed database change, not by the API.
- **An older API.** A replica from before this route answers `404` on `/api/assets`. A client should read that as
  "no assets" and draw the site without equipment, not as an error.
- **Rate limit.** The default, 120 requests per minute per user.
