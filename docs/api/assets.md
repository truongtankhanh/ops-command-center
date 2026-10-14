# Assets

The equipment catalogue of the site: cooling towers, generators, air handlers, sensors. An asset has a class
(what kind of equipment it is and what it measures), a place, and the points its class reports. These routes are
read-only: nothing in the API writes an asset, a point or a rule, and there is no route that commands a device
([ADR-0018](../adr/0018-assets-and-telemetry-as-domain-data.md)). Readings are not here: they arrive on the
telemetry channel, and their history is served by [its own route](#get-an-assets-reading-history).

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

Source: `apps/api/src/assets/assets.controller.ts:39`

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

Source: `apps/api/src/assets/assets.controller.ts:46`

### Get an asset's reading history

<!-- steel:endpoint GET /api/assets/:code/telemetry | params: code, from, to | returns: AssetTelemetry | auth: bearer -->

`GET /api/assets/:code/telemetry?from=&to=` · Status: current

What the leader replica stored for one asset: one sample per 5 second bucket, in ascending time. A console seeds an
inspector's sparklines from it after a reload, and an operator reads back an alarm with it. Any replica serves it
from the database.

| Param  | Type     | Notes                                                                                        |
| ------ | -------- | -------------------------------------------------------------------------------------------- |
| `code` | `string` | `^[A-Z]{2,4}-[A-Z0-9]{2,6}$`, case-sensitive, as above                                       |
| `from` | `string` | optional; start of the range, **inclusive**; defaults to `to` minus 15 minutes               |
| `to`   | `string` | optional; end of the range, **exclusive**; defaults to now; a time in the future is accepted |

`from` and `to` are ISO 8601 with a time and a zone: `2026-10-14T08:00:00Z` or `2026-10-14T15:00:00+07:00`. A date
alone, a time without a zone, or anything else is `400`: the answer must not depend on the server's time zone.

**200** — `AssetTelemetry`
**400** — `code` is not an asset tag; `from` or `to` is not ISO 8601 with a zone; `to` is before `from`; or the range
is longer than 1 hour (720 buckets of 5 seconds). `message` is a list with every reason, and the limit is in it
**401** — missing or invalid bearer token
**403** — the token has no role
**404** — no asset has this code (`Asset XX-99 was not found`)
**429** — rate limit exceeded; see `Retry-After`

`AssetTelemetry`:

| Field       | Type       | Notes                                                                             |
| ----------- | ---------- | --------------------------------------------------------------------------------- |
| `assetCode` | `string`   | the `code` of the path                                                            |
| `from`      | `string`   | ISO time, inclusive: the request with its defaults applied. It is never clamped   |
| `to`        | `string`   | ISO time, exclusive: the request with its defaults applied                        |
| `bucketS`   | `number`   | width of one bucket in seconds, always `5` today                                  |
| `samples`   | `Sample[]` | in ascending time; `[]`, not an error, for an asset with no readings in the range |

`Sample`:

| Field    | Type                                 | Notes                                                                                   |
| -------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| `at`     | `string`                             | ISO time of the start of the bucket (a multiple of 5 s since the epoch)                 |
| `values` | `{ [key]: number, boolean, string }` | the last value of each point `key` received in the bucket; a key not received is absent |

#### What a sample is

- **The bucket is the API's, not the device's.** `at` is the 5 second bucket in which the leader received the
  reading, so a device clock that is minutes off cannot move a sample.
- **An absent key was not received.** It is not `null` and it is not `0`. A point that reports every 60 seconds is
  present in one bucket in twelve.
- **Only the last value of a key in a bucket is kept.** The newest bucket may still be filling: it can gain keys
  until it closes, so a client should treat its last sample as provisional.
- **It is best effort, not a complete record.** A leader failover leaves a gap of about one flush (5 seconds), and
  an outage of the database leaves a longer one.
- **Retention is whole UTC days** (`TELEMETRY_RETENTION_DAYS`). A range outside the kept days is `200` with an empty
  `samples`, never an error.

#### Limits

The range is the half-open interval `[from, to)`: a bucket that starts exactly at `to` is not in it. It may be at most
1 hour long, which is at most 720 samples, so one call answers with a few hundred KB at worst (147 KB measured for
the busiest asset of the demo, which reports every second; its `values` average 247 bytes, at most 362). A longer period is several calls.
There is no pagination, aggregation or export (ADR-0018, "History is coarse").

#### Order of answers

Authentication (`401`), then authorization (`403`), then validation of the code, the query and the range (`400`), then
the asset lookup (`404`). A reversed or over-long range for an asset that does not exist is therefore `400`, and a
valid range for one is `404`.

Source: `apps/api/src/assets/assets.controller.ts:64`

### Notes

- **Roles.** Any known role reads all three routes (`operator`, `supervisor`, `technician`, `viewer`); a token with none
  gets `403`. Authorization runs before validation: a token with no role gets `403` even for a malformed code
  (see [Conventions](README.md#conventions-that-apply-to-every-endpoint)); the same holds for a bad range.
- **No writes.** `POST`, `PUT`, `PATCH` and `DELETE` on `/api/assets` find no route. Equipment and rules are
  changed by a reviewed database change, not by the API.
- **An older API.** A replica from before this route answers `404` on `/api/assets`. A client should read that as
  "no assets" and draw the site without equipment, not as an error. The history route is newer than the two
  catalogue routes: a replica without it answers `404` on `/api/assets/:code/telemetry` for every code, which a
  client should read as "no history" and show only the live readings it received since it connected.
- **Rate limit.** The default, 120 requests per minute per user.
