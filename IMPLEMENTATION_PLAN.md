# Shadow Analysis Accuracy Fix + Satellite Imagery

## Problem

The shadow analysis gives **misleading results**. For a spot on the north side of a house in Cambridge, it reported "12h sun/day" when in reality the house itself blocks the sun for most of the day and the back fence blocks evening sun.

### Root Causes
1. **Building shadow not properly applied** — building position is nearly identical to the marked spot
2. **No obstacle support** — fences (1.8m), trees, walls, sheds are invisible
3. **No directional awareness** — a north-of-building spot should be heavily penalised at UK latitudes
4. **Overconfident output** — "12h/day" with no uncertainty or warnings

---

## Proposed Changes

### 1. Satellite Imagery Layer (All Map Steps)

**Source**: ESRI World Imagery — `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`

No API key needed. Free for non-commercial/development use. Requires attribution: "Powered by Esri — Sources: Esri, Maxar, Earthstar Geographics".

#### [MODIFY] [location.js](file:///c:/Users/gholl/Documents/plug_in_solar/src/steps/location.js)
#### [MODIFY] [building-heights.js](file:///c:/Users/gholl/Documents/plug_in_solar/src/steps/building-heights.js)
#### [MODIFY] [mark-space.js](file:///c:/Users/gholl/Documents/plug_in_solar/src/steps/mark-space.js)
#### [MODIFY] [shadow-analysis.js](file:///c:/Users/gholl/Documents/plug_in_solar/src/steps/shadow-analysis.js)

Add a **map style toggle** button (top-right corner) to every map step:
- 🗺️ **Street** (default OpenFreeMap bright style — shows 3D buildings)
- 🛰️ **Satellite** (ESRI raster imagery)

When satellite is active, users can see their actual property, fences, trees, sheds etc.

> [!NOTE]
> 3D building extrusions only work on the vector street style. When in satellite mode, buildings appear flat but the user can see actual roof shapes and fence lines clearly. Shadow analysis should still default to street view for the 3D lighting visualisation.

---

### 2. Draw Obstacles on Satellite View

#### [MODIFY] [mark-space.js](file:///c:/Users/gholl/Documents/plug_in_solar/src/steps/mark-space.js) — Major rework

Rename step to **"Mark Spaces & Obstacles"**. Add two modes:

**Mode A — Panel Locations** (existing, cleaned up):
- Click on map to place a marker where panels could go
- Set surface type, orientation, tilt

**Mode B — Draw Obstacles** (new):
- **Fence tool** — click two points on the map to draw a fence line. Set fence height (default 1.8m UK standard). The line is visible on both street and satellite views.
- **Tree tool** — click to place a tree marker. Set trunk height (default 5m) and canopy radius (default 3m).
- **Shed/Wall tool** — click to place a rectangular obstruction. Set height (default 2.5m).

Each obstacle is drawn on the map as a coloured overlay:
- Fences = orange dashed line
- Trees = green circle
- Sheds = grey rectangle

Obstacles are saved to state in an `obstacles` array.

#### [MODIFY] [state.js](file:///c:/Users/gholl/Documents/plug_in_solar/src/utils/state.js)
Add `obstacles` to state shape:
```js
obstacles: [
  { type: 'fence', points: [{lat, lng}, {lat, lng}], heightM: 1.8 },
  { type: 'tree', lat, lng, heightM: 5, canopyRadiusM: 3 },
  { type: 'shed', lat, lng, heightM: 2.5, widthM: 3, depthM: 2 },
]
```

---

### 3. Fix Shadow Calculation Engine

#### [MODIFY] [sun.js](file:///c:/Users/gholl/Documents/plug_in_solar/src/utils/sun.js) — Major rewrite

The key insight: at every 15-minute interval, for each panel spot, check whether **any obstruction** (building, fence, tree, shed) casts a shadow that covers that spot.

**For buildings** (the user's house):
- Model as a rectangle on the map at the geocoded location
- Ask the user "which direction does your front door face?" to orient it (simpler than drawing the outline)
- Use a standard UK house footprint: ~5m wide × 9m deep
- Calculate shadow projection from the building rectangle along the sun's shadow vector

**For fences** (drawn lines):
- Model as a thin wall of configurable height
- At each time step, project the fence line's shadow along the shadow direction
- Check if the panel spot falls within the shadow strip (fence length × shadow length)

**For trees** (point markers):
- Model as a cylinder (trunk) with a sphere (canopy)
- Shadow = elongated oval on the ground, dappled (partial shading, ~60-70% reduction)

**For sheds** (rectangles):
- Same approach as buildings but smaller

**Algorithm per spot, per 15-min interval**:
```
1. Get sun position (altitude, azimuth) from SunCalc
2. If sun below horizon → shaded
3. For each obstruction:
   a. Calculate shadow vector: direction = sun_azimuth + 180°
   b. Calculate shadow length = height / tan(altitude)
   c. Project obstruction footprint along shadow vector
   d. Check if spot falls inside projection
4. If any obstruction shadows the spot → that interval = shaded
```

---

### 4. Better UX — Compass Warnings + Building Orientation

#### [MODIFY] [building-heights.js](file:///c:/Users/gholl/Documents/plug_in_solar/src/steps/building-heights.js)

Add a "Front door direction" selector (compass rose or 8-direction buttons: N, NE, E, SE, S, SW, W, NW). This tells us the building orientation so we can model its shadow footprint correctly.

Default to **South-facing front door** (most common UK layout, meaning the back garden faces North).

#### [MODIFY] [shadow-analysis.js](file:///c:/Users/gholl/Documents/plug_in_solar/src/steps/shadow-analysis.js)

- Show **compass indicator** — "Your spot is [DIRECTION] of your building"
- Show **warning badges**:
  - 🔴 "North of building — heavy shading expected" 
  - 🟡 "East of building — limited afternoon sun"
  - 🟢 "South of building — best sun exposure"
- Show **hourly breakdown**: Morning ☀️ | Midday ☀️ | Afternoon ⛅ for each spot
- Show **confidence level**: Low (no obstacles drawn) / Medium / High (obstacles + building direction set)

#### [MODIFY] [results.js](file:///c:/Users/gholl/Documents/plug_in_solar/src/steps/results.js)

- Use actual shadow factor from analysis (not simplified ratio)
- Show **conservative** and **optimistic** range: "290-410 kWh/year"
- Include a disclaimer about the limitations of the shadow model

---

## Implementation Order

1. **Satellite imagery toggle** — quick visual win, users can immediately see their property
2. **Building orientation** — "front door direction" question in Building Heights step
3. **Shadow engine rewrite** — proper geometric projection including building self-shading
4. **Fence/obstacle drawing tools** — draw on satellite view
5. **Compass warnings + honest output** — warning badges, confidence levels
6. **Results improvements** — conservative/optimistic range

---

## Verification Plan

### Test with 9 Chelwood Road, Cambridge
1. Switch to satellite view — verify roof, fences, trees visible
2. Set front door = South (typical UK terraced layout)
3. Mark spot in back garden (north side) — should show ~3-5h/day with warning
4. Mark spot in front garden (south side) — should show ~8-10h/day
5. Draw back fence as obstacle — should reduce back garden score further
6. Compare results: front vs back garden should have dramatically different recommendations

### Manual Verification
- Cross-reference against [PVGIS Horizon Profile](https://re.jrc.ec.europa.eu/pvg_tools/en/)
- Compare shadow patterns with Google Earth time-of-day shadows
