# Roadmap

Each milestone ends in a working, demoable system. Tickets are sized to one pull request each.

## M1 — Foundation ✅

Goal: the full loop works end to end with synthetic data.

| #      | Ticket                                                                                      | Area     |
| ------ | ------------------------------------------------------------------------------------------- | -------- |
| OCC-1  | Monorepo tooling: pnpm workspaces, Turborepo, TS base config, ESLint, Prettier              | repo     |
| OCC-2  | `contracts` package: domain types, enums, WebSocket event map                               | packages |
| OCC-3  | `camera-adapter` package: `CameraSource` port, `MockCameraSource`, `MediaMtxCameraSource`   | packages |
| OCC-4  | API bootstrap: validated config, global validation, error filter, health, OpenAPI           | api      |
| OCC-5  | Persistence: entities, initial migration, boot-time seed of the reference campus            | api      |
| OCC-6  | Zones & cameras read API; camera stream resolution through `CameraSource`                   | api      |
| OCC-7  | Incidents: list / detail / report / acknowledge / resolve with lifecycle rules and timeline | api      |
| OCC-8  | Real-time: domain events + Socket.IO gateway                                                | api      |
| OCC-9  | Incident simulator (configurable, off by default outside dev/demo)                          | api      |
| OCC-10 | Console shell: layout, design tokens, data layer (TanStack Query + socket cache patching)   | console  |
| OCC-11 | Campus map: zones, cameras, incidents; select from map or feed                              | console  |
| OCC-12 | Incident feed with status filter; incident detail with timeline and actions                 | console  |
| OCC-13 | Camera tiles rendering `StreamDescriptor` (mock feed)                                       | console  |
| OCC-14 | Docker Compose one-command run; CI pipeline                                                 | ops      |

## M2 — Real video & richer map

| #      | Ticket                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCC-15 | MediaMTX service in Compose, fed by simulated RTSP publishers; `CAMERA_SOURCE=mediamtx` profile. Stream URLs carry a signed token that MediaMTX verifies (e.g. its auth hook asks the API) and that expires before the access token: today a URL works for anyone who has it (IMP-11)                                                                             |
| OCC-16 | Console HLS/WebRTC player for `StreamDescriptor.kind = hls \| webrtc`; fetches a fresh stream URL before its token expires (OCC-15)                                                                                                                                                                                                                               |
| OCC-17 | Nearest cameras to an incident (PostGIS distance query)                                                                                                                                                                                                                                                                                                           |
| OCC-18 | deck.gl layer: incident density heatmap over the last 24 h                                                                                                                                                                                                                                                                                                        |
| OCC-28 | `VmsCameraSource`: stream URLs, inventory sync and PTZ through the site's VMS API, with a recorded fake ([platform ADR-0009](https://github.com/truongtankhanh/architecture-decisions/blob/main/decisions/0009-reach-cameras-through-the-site-s-video-management-system.md)). VMS stream URLs must be signed and short-lived too, enforced by the VMS (as OCC-15) |

## M3 — Video wall & access control

| #      | Ticket                                                                         |
| ------ | ------------------------------------------------------------------------------ |
| OCC-19 | `apps/video-wall`: read-only, multi-screen layout, auto-rotating camera groups |
| OCC-20 | Extract shared UI and data hooks into `packages/ui` and `packages/data`        |
| OCC-21 | OIDC sign-in (any provider) + roles: operator, supervisor, viewer              |
| OCC-22 | Permission checks on actions; actor recorded on every timeline event           |

## M4 — Operations hardening

| #      | Ticket                                                           |
| ------ | ---------------------------------------------------------------- |
| OCC-23 | Structured logging + request correlation IDs                     |
| OCC-24 | Metrics endpoint (Prometheus) and a Grafana dashboard in Compose |
| OCC-25 | Playwright end-to-end smoke test of the console                  |
| OCC-26 | Incident SLA timers and escalation rules                         |
