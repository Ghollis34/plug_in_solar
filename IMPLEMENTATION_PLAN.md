# Shadow Analysis Accuracy Fix + Satellite Imagery

## Problem

The current shadow analysis can overstate direct sunlight because it only applies a simplified building-shadow heuristic and ignores nearby obstacles. A spot on the north side of a building can currently rank far too well, which leads to overconfident advice and inflated generation estimates.

### Root Causes
1. Building self-shading is modelled as a radius, not an oriented footprint.
2. Fences, trees, and small structures are not part of the analysis contract.
3. Results do not explain why a space was penalised or how confident the estimate is.
4. The current implementation duplicates map setup logic across steps, which makes satellite/overlay work likely to drift.

---

## Scope

### 1. Shared Map Bootstrap + Satellite Toggle

**Provider**: ESRI World Imagery tiles, used as a configurable raster basemap for the app prototype.

Notes:
- No API key is required for the current tile endpoint.
- Use this behind a shared helper, not as a hard-coded production guarantee.
- Keep attribution accurate and configurable.
- Street view remains the default because it supports 3D buildings and lighting.

#### [MODIFY] `src/utils/map-helpers.js`
Create the shared map bootstrap used by all map steps:
- initialise common MapLibre settings
- add 3D buildings once
- add satellite raster source/layer once
- add a reusable street/satellite toggle control
- add reusable overlay helpers for spaces, obstacles, and building footprint previews

#### [MODIFY] `src/steps/location.js`
Use shared map bootstrap and show the map-style toggle here.

#### [MODIFY] `src/steps/building-heights.js`
Use shared map bootstrap and show the map-style toggle here.

#### [MODIFY] `src/steps/mark-space.js`
Use shared map bootstrap and show the map-style toggle here.

#### [MODIFY] `src/steps/shadow-analysis.js`
Use shared map bootstrap and keep street mode as the default initial view for lighting playback.

---

### 2. Explicit Data Model For Obstacles And Analysis

#### [MODIFY] `src/utils/state.js`
Add state fields required by the new workflow:

```js
buildings: [
  {
    id: 'user-building',
    floors: 2,
    pitched: true,
    height: 7.7,
    lat: 52.2,
    lng: 0.1,
    widthM: 5,
    depthM: 9,
    frontDoorFacing: null, // null means unknown
  }
],
obstacles: [
  { id: 'obs-1', type: 'fence', points: [{ lat, lng }, { lat, lng }], heightM: 1.8 },
  { id: 'obs-2', type: 'tree', lat, lng, heightM: 5, canopyRadiusM: 3 },
  { id: 'obs-3', type: 'shed', lat, lng, widthM: 3, depthM: 2, rotationDeg: 0, heightM: 2.5 },
],
sunAnalysis: {
  bestSpaceId: 'space-1',
  scores: [
    {
      id: 'space-1',
      avgDailyHours: 5.2,
      shadowFactor: 0.62,
      conservativeFactor: 0.54,
      optimisticFactor: 0.69,
      confidence: 'medium',
      relativeToBuilding: 'north',
      warningLevel: 'high',
      warnings: ['North of building - heavy shading expected'],
      breakdown: { morning: 'sun', midday: 'mixed', afternoon: 'shade' },
      obstructionSummary: { building: 44, fence: 12, tree: 6 },
    }
  ],
  date: '...'
}
```

Design rules:
- `frontDoorFacing` starts as `null`, not a guessed default.
- Every obstacle needs a stable `id`.
- Rectangular obstacles need rotation if they are rendered or analysed as rectangles.

---

### 3. Building Orientation Without Full Outline Drawing

#### [MODIFY] `src/steps/building-heights.js`
Add a front-door direction selector:
- 8-direction compass buttons: N, NE, E, SE, S, SW, W, NW
- state can remain unknown until the user chooses
- show a preview of the assumed building footprint on the map

Behaviour:
- no hidden default of "south-facing front door"
- if orientation is unknown, keep analysis conservative and mark confidence lower

---

### 4. Mark Spaces And Obstacles

#### [MODIFY] `src/steps/mark-space.js`
Rename to **Mark Spaces & Obstacles** and split the UI into two modes.

**Mode A - Panel Locations**
- click to place candidate panel markers
- set surface type, panel orientation, and tilt

**Mode B - Obstacles**
- fence tool: click two points, set height, save as line
- tree tool: click once, set height and canopy radius
- shed tool: click once to place a rectangular footprint, set size/height, allow rotation if kept in scope

Rendering:
- fences = orange dashed line
- trees = green circle
- sheds = grey footprint or labelled marker

Implementation rule:
- fences and trees are first-class MVP
- sheds can ship as a simpler footprint if needed, but the stored schema must support later refinement

---

### 5. Shadow Engine Rewrite

#### [MODIFY] `src/utils/sun.js`
Replace the current radius-based building test with footprint-aware obstruction checks.

For each analysis interval:
1. Get sun altitude and azimuth from SunCalc.
2. Skip intervals where the sun is below the horizon.
3. Build shadow geometry for each obstruction.
4. Test whether the candidate panel point falls inside any resulting shadow.
5. Record not just shaded/unshaded, but the obstruction type responsible.

Objects:
- user building = oriented rectangle using width/depth and front-door direction
- fence = line segment extruded along shadow vector
- tree = partial-shade obstacle with a lower weighting than full blockage
- shed = small rectangle using width/depth/rotation

Outputs:
- `avgDailyHours`
- `shadowFactor`
- conservative and optimistic factors
- morning/midday/afternoon breakdown
- warnings based on relative building position and obstruction dominance
- confidence based on orientation known, obstacle coverage, and simplifications still in use

Implementation note:
- keep geometry helpers small and pure so they can be unit-tested later
- do not tie the engine to map rendering code

---

### 6. Honest Analysis UI

#### [MODIFY] `src/steps/shadow-analysis.js`
Show explanation, not just ranking:
- building-relative direction for each space
- warning badges
- confidence level
- morning / midday / afternoon breakdown
- visible obstacle overlays on the map

Examples:
- high warning: `North of building - heavy shading expected`
- medium warning: `East of building - limited afternoon sun`
- positive signal: `South of building - strongest direct sun`

---

### 7. Results Based On Real Analysis Outputs

#### [MODIFY] `src/steps/results.js`
Use `shadowFactor`, `conservativeFactor`, and `optimisticFactor` from analysis instead of deriving shading from `avgDailyHours / 12`.

Add:
- conservative and optimistic annual generation range
- confidence summary
- warning summary for the recommended spot
- disclaimer about model limitations

---

## Implementation Order

1. Shared map bootstrap and reusable basemap toggle.
2. State/schema updates for building orientation, obstacles, and richer `sunAnalysis`.
3. Building orientation selector and footprint preview.
4. Space + obstacle capture flow.
5. Shadow engine rewrite using the new schema.
6. Honest analysis UI and results integration.

This order is deliberate: the geometry and analysis contract must exist before the UI can present trustworthy ranges, warnings, or confidence levels.

---

## Verification Plan

### Automated / Deterministic Checks
Add fixed geometry test cases for:
1. panel point north of a south-facing building at midday
2. fence casting a long winter-afternoon shadow
3. tree partial shading reducing output less than full building blockage
4. same point with unknown orientation yielding lower confidence than explicit orientation

### Manual Smoke Test
Use 9 Chelwood Road, Cambridge:
1. switch to satellite view and verify the property context is visible
2. set building height and front-door direction explicitly
3. mark one point in the back garden and one in the front
4. draw the rear fence
5. confirm the rear point ranks materially lower and shows stronger warnings

### Cross-Checks
- use PVGIS as an irradiance baseline, not as a validation source for near-field obstacle shading
- compare major shadow expectations against aerial imagery and known building orientation
