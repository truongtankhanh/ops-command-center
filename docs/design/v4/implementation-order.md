# Console V4 — implementation order

Status: **proposed** (2026-10-21), **not scheduled**. The direction is in [brief.md](brief.md). This file fixes the
order the six V4 items would be built in if V4 is scheduled, and what each waits for. It follows the rules V2 and V3
used:

1. **ADR first.** Every item changes the domain or adds an outside channel, so each starts with its ADR, accepted.
2. **Smallest and most shared first.** The item that others reuse (a selection, a flood measure, grouping) comes before
   the ones that build on it.
3. **Incidents must all arrive.** Anything that changes an incident goes through the outbox in the same transaction
   (ADR-0007); anything that only reads history or sends a message never does.
4. **No visual-only shortcut.** An action is a permission checked by the API; the console only hides what a role
   cannot do (ADR-0011).

Each ticket is one pull request per task, as in V2 and V3; task lists are written when a ticket is about to start, not
now. "V3-nn" and "V3.5" name tickets of [../v3/implementation-order.md](../v3/implementation-order.md).

## What V4 waits for

V4 starts after V3 and V3.5 have landed:

| Needs                                     | Because                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| V3-21 alarm load, flood and noisy devices | Shelving acts on noisy devices; notifications need the flood measure to summarise instead of spam |
| V3-22 attention countdown                 | Guided response reuses its deadline component                                                     |
| V3-23 reading range                       | Replay extends it from one asset and one hour to the campus                                       |
| V3-24 table mode                          | Bulk acknowledge is the table's missing action; grouping is selected from it                      |
| V3-26 shift handover (V3.5)               | Active shelves and open SOP steps belong in a handover                                            |
| ADR-0022 to ADR-0024 accepted             | The token set, the building levels and the handover record are the base V4 builds on              |

## Phase 0 — ADRs (gate)

| #     | Work                                                                                                                                                       | Done when                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| V4-00 | Write and accept ADR-0025 to ADR-0030 as the items are scheduled, settle each brief open question it owns, list each in the README and architecture tables | The ADR of an item says **Accepted** before that item's ticket starts |

The six ADRs do not need to be accepted together: an item whose ADR is accepted can start. The supervisor-only
permission model (brief § Permissions in V4, open question 1) is settled with the first ADR that needs it.

## The tickets

Numbers follow the ADRs; the order to build them in is the **Wave** column.

| #     | Ticket                                                                       | ADR      | Wave | Depends on                                         | Area                      |
| ----- | ---------------------------------------------------------------------------- | -------- | ---- | -------------------------------------------------- | ------------------------- |
| V4-01 | Guided response: SOP checklists, steps in the timeline, a countdown          | ADR-0025 | 3    | V3-22, V3-09, ADR-0011 follow-up (supervisor-only) | contracts · api · console |
| V4-02 | Incident grouping: groups as a label, derived lifecycle, never-hide-severity | ADR-0026 | 2    | V3-21, V3-24, V4-06                                | contracts · api · console |
| V4-03 | Alarm shelving: reason, expiry, never Critical, new outbox events            | ADR-0027 | 2    | V3-21, V3-26                                       | api · console             |
| V4-04 | Campus replay: rollup, retention, replay endpoint, scrubber                  | ADR-0028 | 1    | V3-23, incidents `from` and `to` (from V3-21)      | api · ops · console       |
| V4-05 | External notifications: channels, rules, claimed delivery queue, floods      | ADR-0029 | 3    | V4-02, V4-03, V3-21, ADR-0006 amendment            | api · ops · console       |
| V4-06 | Bulk acknowledge: batch route, per-incident results, rate limit              | ADR-0030 | 1    | V3-24                                              | contracts · api · console |

- **V4-06** is the smallest and the one V4-02 reuses (acknowledging a group is acknowledging its members), so it goes
  first. It adds no table: a route, a contract shape, a rate-limit bucket and the table's selection.
- **V4-04** is independent of the others and has the longest lead time (the retention decision and a cost model on real
  data), so it starts in wave 1 beside V4-06 even though it ships later in the console.
- **V4-02** needs the flood measure and the table before it, and V4-06 for group acknowledge. It must be ready before
  V4-05, so notifications send one message per group.
- **V4-03** needs the noisy-device list to be worth building and the handover to list its shelves; without either a
  shelve can be forgotten, which is the failure the ADR must prevent.
- **V4-01** and **V4-05** are last: the first needs the supervisor-only permission model decided and a site-authored SOP
  to exist; the second needs grouping, shelving and ADR-0006's secrets and production rules extended.

## Dependencies

```text
V3 + V3.5 ─┬─ V4-06 bulk ack ───────┐
           ├─ V4-04 replay (long lead: retention, cost)
           │                        ├─ V4-02 grouping ─┐
           ├─ V3-21 ── V4-03 shelving ──────────────────┼─ V4-05 notifications
           └─ V3-22 ── V4-01 guided response ───────────┘   (step_overdue, shelve_expiring)
```

- V4-01 does not require V4-05, but its **supervisor alert** is only in-console until V4-05 exists; the ADR says so.
- V4-05's triggers `step_overdue` and `shelve_expiring` are only available once V4-01 and V4-03 exist.
- V4-04 touches `GET /api/incidents` (a `from` and `to` filter). The brief recommends building that filter once, in
  V3-21, so V4-04 only reuses it.

## Cross-cutting rules

- **Contract and schema are additive** (optional fields, nullable columns, new tables, appended enum values and
  permissions), so the console and the API deploy in either order; the one exception to check per ADR is an older
  console meeting a new `IncidentEventKind` or outbox event name.
- **Migrations are append-only** and registered in `database/typeorm-options.ts`; a new outbox event name replaces the
  `event` `CHECK` (ADR-0007), which V4-03 does.
- **Production guards (ADR-0006).** No SOP, channel, rule or shelve is seeded outside demo; outbound channels are HTTPS
  only; secrets are named, never stored, and added to the log redaction list.
- **Rate limits and advisory-lock keys** have one home each; V4-05's claimed queue needs no new lock, V4-06 a new bucket
  in `rate-limits.ts`.
- **Every action carries the role rules** of brief § Permissions in V4 in its acceptance criteria, including the
  technician's category scope and the viewer's read-only footer.
- **Docs.** Each ticket updates `docs/api/` and `openapi.json` for its routes, the ADR table in `README.md` and
  `docs/architecture.md` §9, and this order if its scope moves.

## Not in V4

Camera preview at the time of an alarm and an external work-order reference have no owner and no ticket; they are
described in [brief.md](brief.md#not-scheduled-no-owner). Assignment of incidents (V3-B) and a light theme (V3-C) stay
the unscheduled tracks of [../v3/implementation-order.md](../v3/implementation-order.md).

## Notes

- Nothing here has a frame. When an item is scheduled its frames are drawn first, as V2 and V3 did, then this order if a
  ticket's scope moves.
- The V4 brief records its open questions; a decision on one goes into that item's ADR, not only into the brief.
