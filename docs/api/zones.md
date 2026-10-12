# Zones

### List zones

<!-- steel:endpoint GET /api/zones | returns: Zone[] | auth: bearer -->

`GET /api/zones` · Status: current

Every zone of the campus with its outline, ordered by name. Reference data — clients can cache
it for the session.

**200** — `Zone[]`
**401** — missing or invalid bearer token
**403** — the token has no role

| Field     | Type                       | Notes                                                                    |
| --------- | -------------------------- | ------------------------------------------------------------------------ |
| `id`      | `uuid`                     |                                                                          |
| `code`    | `string`                   | e.g. `BLD-LIB`                                                           |
| `name`    | `string`                   |                                                                          |
| `kind`    | enum, see below            |                                                                          |
| `use`     | enum, see below, or `null` | buildings only                                                           |
| `heightM` | `number` or `null`         | metres above ground of a building's shell; `null` = the client's default |
| `polygon` | `[lng, lat][]`             | closed ring                                                              |
| `center`  | `[lng, lat]`               | default position for incidents reported in this zone                     |

| Enum   | Values                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind` | `building`, `parking`, `gate`, `outdoor`, `sports`, `utility`, `water`                                                                                       |
| `use`  | `academic`, `library`, `laboratory`, `residential`, `dining`, `healthcare`, `sports_hall`, `administration`, `data_center`, `security_post`, `utility_plant` |

`kind` is how a zone is drawn; `use` is what a building is used for
([ADR-0021](../adr/0021-incident-categories-zone-uses-and-technician-role.md)). `use` is `null`
for every other kind, and for a building whose use is not set. It drives report-form
suggestions and restricts nothing. An API older than this field does not send it: read a
missing `use` as `null`.

`heightM` is how tall a building's shell is drawn in 3D, in metres above ground
([ADR-0018](../adr/0018-assets-and-telemetry-as-domain-data.md)); it is greater than zero when
set. `null` means no height is set and the client draws its default. An API older than this
field does not send `heightM`: read a missing value as `null`.

Source: `apps/api/src/zones/zones.controller.ts:23`
