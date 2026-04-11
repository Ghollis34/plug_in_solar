# Map Refactor Plan

## Goal

Reduce regressions in the map-driven steps by refactoring the parts of the codebase that are actually drifting:

- repeated map lifecycle code across steps
- inconsistent map readiness checks
- scene rendering that depends on step-local sequencing
- weak type boundaries around buildings, spaces, obstacles, and map runtime helpers

This plan intentionally does **not** start with a class rewrite, a global map store, or a full TypeScript migration.

---

## What We Are Taking From The Junior Feedback

### Keep

1. Improve encapsulation around map lifecycle.
2. Reduce duplication in layer/source management.
3. Strengthen type safety around object shapes and helper contracts.

### Defer Or Reject For Now

1. **No `MapController` / `MapManager` class as the first step**
   - The current problem is duplicated lifecycle and render sequencing, not the absence of a class.
   - A shared helper/session abstraction is a smaller and safer extraction.

2. **No Zustand / Redux map store**
   - Persistent wizard state already lives in [src/utils/state.js](src/utils/state.js).
   - The fragile state is transient runtime state such as timers, markers, render nonces, and active map instances. Moving that into a global store would increase coupling.

3. **No custom event bus / provider pattern yet**
   - Direct map access is already limited to the map steps and helpers.
   - Another abstraction layer would make debugging render-order bugs harder before lifecycle is cleaned up.

4. **No full TypeScript migration in phase 1**
   - TypeScript is useful here, but it should follow boundary cleanup so we do not just type duplicated logic.

---

## Current Pressure Points

### 1. Step Lifecycle Is Repeated In Four Places

The same runtime loading, token cancellation, map creation, and cleanup shape exists in:

- [src/steps/location.js](src/steps/location.js)
- [src/steps/building-heights.js](src/steps/building-heights.js)
- [src/steps/mark-space.js](src/steps/mark-space.js)
- [src/steps/shadow-analysis.js](src/steps/shadow-analysis.js)

This is now the main regression surface.

### 2. Map Readiness Rules Are Inconsistent

Recent regressions came from step-local readiness checks diverging from real MapLibre behavior. That logic should not be hand-rolled differently in each step.

### 3. Scene Updates Are More Imperative Than They Need To Be

Helpers such as obstacle, heatmap, and shadow rendering already live in [src/utils/map-helpers.js](src/utils/map-helpers.js), but step modules still have to know too much about when it is safe to call them and how often to retry.

### 4. Persistent And Runtime State Are Mixed Conceptually

Persistent wizard state is centralized and reasonable. Runtime step state is local but not consistently bounded. We should improve boundaries without introducing a second app-wide state system.

---

## Target Architecture

### Persistent App State

Keep in [src/utils/state.js](src/utils/state.js):

- `location`
- `buildings`
- `obstacles`
- `spaces`
- `sunAnalysis`
- `selectedKit`
- `results`

### Transient Step Runtime State

Keep local to the active step or session:

- active `map` instance
- markers
- idle handles / timeouts
- render nonces
- in-progress placement mode
- current interaction-only UI state

### Shared Map Platform Layer

Consolidate in utilities:

- lazy runtime loading in [src/utils/map-runtime.js](src/utils/map-runtime.js)
- common map bootstrap and overlay primitives in [src/utils/map-helpers.js](src/utils/map-helpers.js)
- new shared step-session lifecycle helper

---

## Phased Refactor

## Phase 1: Shared Step Map Lifecycle

### Objective

Remove duplicated map bootstrap and cleanup logic from the four step modules.

### Deliverable

Create a new helper, likely:

- `src/utils/map-step-session.js`

### Responsibilities

- load map runtime once
- create a step-scoped map session
- track cancellation / invalidation token
- expose safe `destroy()`
- expose a shared map readiness helper
- centralize event listener disposal for map-level listeners

### Files To Update

- `src/utils/map-runtime.js`
- `src/utils/map-step-session.js` (new)
- `src/steps/location.js`
- `src/steps/building-heights.js`
- `src/steps/mark-space.js`
- `src/steps/shadow-analysis.js`

### Success Criteria

- each step stops manually reimplementing token/cancel/bootstrap patterns
- step cleanup becomes small and deterministic
- map load failures and step transitions behave consistently

---

## Phase 2: Idempotent Scene Rendering

### Objective

Make overlay rendering safe to call repeatedly without relying on step-specific retry choreography.

### Deliverable

Refactor rendering helpers so they update sources/layers predictably and use a single readiness rule.

### Work

- add a shared `hasUsableMapStyle(map)` helper
- make building preview, obstacles, heatmap, and shadow helpers idempotent
- prefer source data updates over remove/re-add where practical
- isolate “ensure source/layer exists” behavior inside helpers instead of step files

### Files To Update

- `src/utils/map-helpers.js`
- `src/steps/building-heights.js`
- `src/steps/mark-space.js`
- `src/steps/shadow-analysis.js`

### Success Criteria

- heatmap, obstacles, and shadow overlays render after first load without cross-step priming
- fewer step-local fallback timers and duplicate refresh paths
- overlay code is driven by helper contracts rather than step-specific sequencing

---

## Phase 3: State Boundary Cleanup

### Objective

Clarify what belongs in persistent wizard state versus what is purely derived or session-local.

### Deliverable

Add selectors and shape-focused utilities instead of introducing a new store.

### Work

- extract selectors for common domain reads such as:
  - primary building
  - building footprint
  - effective analysis center
  - normalized obstacle collections
- reduce repeated `getState(...)` + fallback logic inside map steps
- keep runtime-only values out of persistent state

### Files To Update

- `src/utils/state.js`
- `src/utils/state-normalizers.js`
- `src/utils/site-obstacle-state.js`
- new selector/helper module if needed, for example `src/utils/site-state.js`
- map step modules that currently inline these lookups

### Success Criteria

- map step files focus more on user interaction and less on data plumbing
- building/space/obstacle access patterns become consistent across steps
- future UI work does not need to rediscover the same state shape rules

---

## Phase 4: Type Safety Without Full Migration

### Objective

Improve safety around the highest-risk shapes before deciding whether a TypeScript migration is worth the cost.

### Deliverable

Introduce typed boundaries incrementally.

### Work

- add JSDoc typedefs for:
  - `Building`
  - `Obstacle`
  - `Space`
  - `SunAnalysisScore`
  - map runtime helper contract
- enable `// @ts-check` on the most fragile utility modules first if it stays low-friction
- add tests for helper contracts that have recently regressed

### Candidate Files

- `src/utils/map-helpers.js`
- `src/utils/sun.js`
- `src/utils/state-normalizers.js`
- `src/utils/solar-placement.js`

### Success Criteria

- shape mistakes are caught earlier in editing
- helper inputs/outputs are explicit
- we get real safety value before committing to a whole-repo TypeScript conversion

---

## Explicit Non-Goals For This Refactor

- introducing Redux or Zustand
- rewriting map steps into classes first
- creating a custom event bus around the map
- migrating the whole repo to TypeScript in one pass
- redesigning the UX flow as part of this maintenance refactor

Those may become reasonable later, but they are not the highest-leverage fixes for current instability.

---

## Suggested Implementation Order

1. Phase 1: shared step map lifecycle
2. Phase 2: idempotent scene rendering
3. Phase 3: state boundary cleanup
4. Phase 4: typed boundaries

This order is deliberate:

- phase 1 removes the largest duplication surface
- phase 2 addresses the regression class we have just been fixing
- phase 3 improves maintainability without adding global complexity
- phase 4 adds safety after boundaries are cleaner

---

## Verification Plan

### Automated

Add or extend tests around:

1. map helper readiness behavior
2. obstacle normalization and rendering inputs
3. placement heatmap generation inputs
4. annual solar recommendation inputs and outputs
5. state normalization for buildings, spaces, and obstacles

### Manual Smoke Checks

For each map step:

1. enter the step directly from the normal wizard path
2. refresh on that step
3. navigate away and back
4. confirm overlays still render without needing another step to “prime” the map

### Refactor Exit Criteria

- placement heatmap and obstacles load correctly on first visit
- shadow step remains stable after the shared lifecycle extraction
- each map step has materially less lifecycle code
- no user-visible behavior regression in location, site setup, placement, or shadows

---

## First Concrete Slice

If work starts immediately, the first PR should only do this:

1. add `map-step-session.js`
2. migrate `location.js` and `shadow-analysis.js` to it
3. leave behavior unchanged
4. verify step transitions and cleanup

That gives us the pattern with the lowest product risk before touching the more interaction-heavy site setup and placement steps.
