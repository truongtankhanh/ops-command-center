# Site plan

### Get the site plan

<!-- steel:endpoint GET /api/site-plan | returns: SitePlan | auth: bearer -->

`GET /api/site-plan` · Status: current

What to draw under and between the zones: the site boundary, roads and sports-field markings, in drawing order
([ADR-0017](../adr/0017-site-plan-as-data.md)). Building footprints and parking rows are not included; clients derive
them from the zones (`GET /api/zones`). Reference data — clients can cache it for the session.

**200** — `SitePlan`
**401** — missing or invalid bearer token
**403** — the token has no role
**404** — no site plan has been set up (`Site plan was not found`); draw the zones only

| Field      | Type            | Notes                                       |
| ---------- | --------------- | ------------------------------------------- |
| `id`       | `uuid`          |                                             |
| `code`     | `string`        | e.g. `LANGBIANG`                            |
| `name`     | `string`        |                                             |
| `center`   | `[lng, lat]`    | centre of the site; where a map opens       |
| `features` | `SiteFeature[]` | lowest first in drawing order; may be empty |

`SiteFeature`:

| Field      | Type                              | Notes                                              |
| ---------- | --------------------------------- | -------------------------------------------------- |
| `part`     | `boundary` \| `road` \| `field`   | what the feature draws                             |
| `geometry` | GeoJSON `Polygon` \| `LineString` | `{ type, coordinates }`, positions as `[lng, lat]` |

A `Polygon`'s `coordinates` are closed rings, outer ring first; a `LineString`'s are points in order.

One site is served today. Zones do not reference a site yet; a second site needs that first (see ADR-0017).

Source: `apps/api/src/sites/sites.controller.ts:26`
