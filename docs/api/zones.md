# Zones

### List zones

<!-- steel:endpoint GET /api/zones | returns: Zone[] | auth: bearer -->

`GET /api/zones` · Status: current

Every zone of the campus with its outline, ordered by name. Reference data — clients can cache
it for the session.

**200** — `Zone[]`
**401** — missing or invalid bearer token

| Field     | Type                                           | Notes                                                |
| --------- | ---------------------------------------------- | ---------------------------------------------------- |
| `id`      | `uuid`                                         |                                                      |
| `code`    | `string`                                       | e.g. `BLD-LIB`                                       |
| `name`    | `string`                                       |                                                      |
| `kind`    | `building` \| `parking` \| `gate` \| `outdoor` |                                                      |
| `polygon` | `[lng, lat][]`                                 | closed ring                                          |
| `center`  | `[lng, lat]`                                   | default position for incidents reported in this zone |

Source: `apps/api/src/zones/zones.controller.ts:16`
