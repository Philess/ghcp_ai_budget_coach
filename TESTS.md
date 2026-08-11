# Simulator Test Plan

This document defines the functional test contract for the AI Credit Budget
Simulator. It maps the budget rules in [README.md](README.md) to unit and
browser-level coverage.

## Scope

The suite validates every documented decision branch, precedence rule,
membership path, hard-stop mode, exact-cap boundary, and important
interaction. Representative pairwise combinations are used instead of an
unbounded Cartesian product of every numeric value and entity count.

The tests do not call live GitHub billing APIs, test the availability of the
deployed GitHub Pages site, or use pixel-perfect visual snapshots.

## Rules and invariants

- A Copilot Business seat contributes **1,900 included AI credits per month**.
- A Copilot Enterprise seat contributes **3,900 included AI credits per
  month**.
- Metered usage costs $0.01 per credit (100 credits per dollar).
- User-level budget (ULB) precedence is individual, then cost center, then
  universal.
- A ULB caps total usage across included and metered phases and always applies
  a hard stop.
- An enabled cost-center pool reserves credits according to the license types
  of its resolved members.
- Users without a reserved cost-center pool draw from the unreserved
  enterprise pool.
- Included pools are common shared pools. The starting point consumes them in
  user-list order; post-baseline draws consume them in the order users were
  first changed, then user-list order for restored usage without an edit
  sequence.
- Metered usage follows the same FIFO order. Re-editing a user updates that
  user's existing sequence entry and never moves it.
- **Last Call** is the actual result of a user's latest simulated consumption.
  A later action by another user never retroactively rewrites it.
- **Next Call** projects one additional credit from the final shared pool and
  budget state.
- The results table groups **Last Call Details** immediately after **Last Call**.
  Consumption shows the effective total ULB inline as `/total` in the selected
  unit, or `/∞` when no ULB applies; it does not duplicate remaining headroom.
- Exhausting a hard-stop cost-center or organization budget blocks Next Call
  for every active user in that scope. The action that exceeds the cap is
  blocked on both Last Call and Next Call.
- Exhausting the enterprise hard-stop budget blocks users that need overage;
  their Next Call is blocked, while users still fully served from an included
  pool remain served.
- Exactly reaching a pool or budget cap is allowed. A hard stop takes effect
  when demand exceeds the cap.

## Test layers

| Layer | Responsibility |
|---|---|
| Node unit tests | Calculation details, FIFO ordering, two-status projections, state normalization, and boundary behavior without a browser |
| Playwright E2E tests | Configuration workflows, browser persistence, rendered Last Call/Next Call statuses, reasons/accounting, and multi-step transitions |

One E2E scenario creates a representative enterprise through the real UI.
Decision-matrix scenarios preload deterministic state through `localStorage`,
then perform usage changes and assertions through the rendered UI. This keeps
the tests isolated and fast without bypassing the behavior being tested.

## Shared fixture catalog

| Fixture | Shape | Purpose |
|---|---|---|
| `solo-enterprise` | One Business and one Enterprise user; no org, team, or cost center | Shared enterprise pool and mixed-license calculations |
| `engineering-cc` | Engineering org and enterprise team mapped to an Engineering cost center | Reserved pool, membership resolution, CC ULB, and CC overage |
| `multi-scope` | Engineering and Marketing orgs/teams/cost centers plus an unassigned user | Scope isolation and combined budget checks |
| `ulb-precedence` | Universal, cost-center, and individual ULBs at different values | Most-specific ULB precedence |
| `ordered-overage` | Three Business users at a 1,900-credit baseline; $1 CC hard-stop budget; explicit action order | Deterministic Last Call outcomes and final-state Next Call freeze |

Every fixture defines `usage`, `usageBaseline`, `usageSequence`,
`simulationUnit`, and `globalBudgetPercents` explicitly.

## Scenario matrix

### Configuration and membership

| ID | Setup and actions | Expected result |
|---|---|---|
| CFG-01 | Complete the wizard with organizations, teams, cost centers, mixed-license users, ULBs, and scoped budgets | The review and saved configuration show every entity and budget |
| CFG-02 | Enable a cost-center reservation after setup | Member count, pool size, reserved total, and enterprise remainder are recalculated |
| CFG-03 | Reload a UI-created configuration | Entities, budgets, pool settings, unit, and controls persist |
| CFG-04 | Resolve separate users through direct CC, enterprise-team, organization, and direct-user-list assignment | Each user draws from the expected cost center |
| CFG-05 | Leave a user outside every cost center | The user draws only from the unreserved enterprise pool |
| CFG-06 | Enable auto seats with one Business and one Enterprise user | Seat counts are 1 and 1 and the total pool is exactly 5,800 credits |

### Included-pool routing

| ID | Setup and actions | Expected result |
|---|---|---|
| POOL-01 | Unassigned user consumes below enterprise-pool capacity | `served`; source is enterprise pool; no metered usage |
| POOL-02 | Cost-center member consumes below reserved-pool capacity | `served`; source is cost-center pool; enterprise pool is unchanged |
| POOL-03 | Exhaust CC pool with overages allowed while enterprise pool has room | `served`; source shows CC and enterprise pools |
| POOL-04 | Exhaust CC pool with overages disabled | `blocked` before enterprise or metered capacity; reason identifies the CC pool |
| POOL-05 | Several CC members compete for a residual reserved pool | Residual credits are consumed FIFO; later members block once the shared pool and hard-stop budget are exhausted |
| POOL-06 | Several unreserved users compete for residual enterprise capacity | Residual credits are consumed FIFO; later users block once the enterprise pool and hard-stop budget are exhausted |
| POOL-07 | Keep CC reservations while an unassigned user consumes | The unassigned user cannot consume reserved credits |
| POOL-08 | Consume one below, exactly at, and one above pool capacity | Below/at are `served`; above follows the next configured branch |

### Metered policy and scoped budgets

| ID | Setup and actions | Expected result |
|---|---|---|
| MTR-01 | Exhaust pools with metered policy disabled | `blocked`; reason identifies disabled metered usage; budget gauges remain unused |
| MTR-02 | Exhaust pools with metering and all budgets available | `metered`; visible credits and cost are correct |
| MTR-03 | Exercise CC hard stop one below, at, and one above its cap | Below/at have metered Last Call; the failing action is blocked on both statuses, earlier members retain Last Call, and every active CC member has blocked Next Call |
| MTR-04 | Exercise organization hard stop one below, at, and one above its cap | Below/at have metered Last Call; the failing action is blocked on both statuses, earlier members retain Last Call, and every active org member has blocked Next Call |
| MTR-05 | Exercise enterprise hard stop one below, at, and one above its cap | The failing overage action is blocked on both statuses; earlier overage users retain Last Call but have blocked Next Call, while pool-only users remain served |
| MTR-06 | Exceed a CC budget with hard stop disabled | Usage remains `metered`; the gauge may exceed 100% |
| MTR-07 | Exceed an org budget with hard stop disabled | Usage remains `metered`; the gauge may exceed 100% |
| MTR-08 | Exceed enterprise budget with hard stop disabled | Usage remains `metered`; the gauge may exceed 100% |
| MTR-09 | Configure CC, org, and enterprise caps together | The smallest applicable headroom controls Next Call; a failing action is blocked on both statuses and the reason identifies that scope |
| MTR-10 | Configure a zero-dollar hard-stop budget | The first metered credit is blocked on both statuses; all applicable scope members have blocked Next Call |
| MTR-11 | Meter 1, 100, and 101 credits | Values render as $0.01, $1.00, and $1.01 in rows, summary, and gauges |

### User-level budgets

| ID | Setup and actions | Expected result |
|---|---|---|
| ULB-01 | Consume below, exactly at, and one above universal ULB | Below/at continue normally; above is blocked before pool/budget draw |
| ULB-02 | Give a CC member a CC ULB different from universal | CC value is effective |
| ULB-03 | Give that member an individual ULB different from both | Individual value is effective |
| ULB-04 | Exceed ULB while all scoped budgets have room | ULB wins and reason identifies its source |
| ULB-05 | Exhaust a scope budget below an otherwise available ULB | Scope hard stop wins |
| ULB-06 | Exceed ULB while included pool still has room | User is blocked during the pool phase |
| ULB-07 | Cross ULB through a post-baseline edit | ULB applies to total usage, not only the delta |

### Starting point and ordered usage

The canonical transition uses three Business users in one cost center. Each
starts at 1,900 credits, consuming the 5,700-credit enterprise pool exactly.
The cost center has a $1 hard-stop overage budget (100 metered credits).

| ID | Step | Expected transition |
|---|---|---|
| SEQ-01 | Distribute baseline usage and click **Set as Starting Point** | All three users are `served`; baseline consumes the enterprise pool in user-list order; edit order is empty |
| SEQ-02 | Change Thierry from 1,900 to 1,960 | Thierry's Last Call is `metered`; others' Last Call stays `served`; CC budget usage is $0.60 |
| SEQ-03 | Change Matthieu from 1,900 to 1,940 | Thierry and Matthieu have `metered` Last Call; Philippe stays `served`; budget is exactly $1.00 |
| SEQ-04 | Change Philippe from 1,900 to 1,910 | Philippe is Last Call `blocked` / Next Call `blocked`; Thierry and Matthieu are Last Call `metered` / Next Call `blocked`; all show the CC-budget Next Call reason |
| SEQ-05 | Repeat the changes in reverse order | Last Call follows action order: the action that exceeds the cap is blocked on both statuses, prior successful actions retain their outcomes; final blocked Next Call for the scope is order-independent |
| SEQ-06 | Re-edit an earlier user | The existing sequence entry is updated in place: the user keeps its original application position and the new value is applied there |
| SEQ-07 | Apply a new global distribution | Usage is atomically replaced and per-user edit order clears |
| SEQ-08 | Set a new starting point | Baseline becomes current usage and edit order clears |
| SEQ-09 | Reset usage | Usage, baseline, global percentages, and edit order clear |
| SEQ-10 | Reload after ordered edits | The same baseline, order, values, Last Call/Next Call statuses, and reasons are restored |

### Dashboard and lifecycle

| ID | Setup and actions | Expected result |
|---|---|---|
| UI-01 | Mix served, metered, and blocked Last Calls with blocked Next Calls | Summary counts each status column correctly and total metered usage equals actual metered Last Calls |
| UI-02 | Consume pool and scoped budgets | Gauges show correct used, total, percentage, and threshold color |
| UI-03 | Switch credits to dollars and back | Underlying usage/status is unchanged; usage, Last Call details, and finite inline ULB totals convert exactly while `/∞` remains unchanged |
| UI-04 | Filter users by name | Only row visibility changes; usage and order do not |
| UI-05 | Inspect the result table layout | Columns appear as Consumption, Last Call, Last Call Details, Next Call, and Next Call Reason; no standalone ULB Remaining column exists |
| LIFE-01 | Import a deterministic configuration with optional fields omitted | State is normalized, rendered, and persisted after reload |
| LIFE-02 | Cancel and then confirm reset | Cancel preserves state; confirm restores defaults and empty dashboard |
| LIFE-03 | Load the page | `styles.css` and `app.js` load successfully with no browser errors |

## README rule traceability

| README rule | Scenarios |
|---|---|
| ULB is evaluated first and always hard-stops | ULB-01 through ULB-07 |
| Cost-center pool precedes enterprise pool | POOL-02 through POOL-04 |
| Overages-disabled cost center blocks on pool exhaustion | POOL-04 |
| Enterprise pool precedes metered usage | POOL-01, POOL-03, POOL-08 |
| Disabled metered policy blocks after pools | MTR-01 |
| CC, org, and enterprise budgets govern metered usage | MTR-03 through MTR-10 |
| Lowest applicable headroom wins | MTR-09, ULB-04, ULB-05 |
| Individual ULB overrides CC, which overrides universal | ULB-01 through ULB-03 |
| Pool reservations follow membership and license count | CFG-02, CFG-04, CFG-06 |
| User outside a cost center uses unreserved pool | CFG-05, POOL-07 |
| Baseline, included pools, and metered usage follow FIFO order | POOL-05, POOL-06, SEQ-01 through SEQ-10 |
| Last Call is historical; Next Call projects final shared state | MTR-03 through MTR-05, MTR-09, MTR-10, SEQ-02 through SEQ-05, UI-01 |
| Scope hard stops freeze Next Call without rewriting earlier Last Calls | MTR-03 through MTR-05, SEQ-04, SEQ-05 |

## Running tests

```bash
# Calculation/unit tests
npm test

# Headless Chromium E2E tests
npm run test:e2e

# All tests
npm run test:all

# Interactive troubleshooting
npm run test:e2e:headed
npm run test:e2e:debug
```

CI emits JUnit XML for both test layers. Same-repository pull requests receive
one automatically updated **Simulator Test Results** comment plus a named
GitHub Check with totals, duration, and failure annotations. The same result is
available in the workflow job summary.

Every non-cancelled run uploads a `simulator-test-report` artifact containing
the JUnit files and Playwright HTML report. Failed runs additionally retain
traces, screenshots, videos, and the HTML report in
`playwright-diagnostics`. Fork pull requests keep normal workflow checks and
artifacts but skip write-token publishing.

Tests use a fresh browser context and fresh fixture object for every case; no
local-storage state is shared between tests.

## Acceptance criteria

- Every README flowchart branch and “Key Interactions & Gotchas” row maps to a
  scenario above.
- Budget, pool, and ordering outcome scenarios assert the Last Call status with
  its source/reason detail, the Next Call projection, and the pool or budget
  accounting the scenario's rule depends on; statuses alone are insufficient
  there. Configuration, dashboard, and lifecycle scenarios only assert the
  outcomes their rule is about.
- Multi-step browser tests demonstrate successful metered Last Calls, a blocked
  failing Last Call, and blocked Next Call for the final hard-stopped scope from
  a saved starting point.
- Direct, enterprise-team, organization, direct-list, and no-cost-center
  membership paths are covered.
- Hard-stop on/off and exact-cap boundaries are covered for cost-center,
  organization, and enterprise budgets, including the non-retroactive Last Call
  and scope-wide Next Call freeze semantics.
- All documentation, UI labels, calculations, fixtures, and assertions use
  1,900 Business / 3,900 Enterprise credits.
- The test suite passes from a clean checkout in headless Chromium.
