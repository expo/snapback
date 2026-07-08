# Hand-drawn station art

Original hand-drawn-style SVG artwork for every All Aboard station: three
scenes per station, 63 files. Drawn 2026-07-08 by Claude (Fable 5) agents
working from one shared style guide (wobbly brown-black ink outlines built
from jittered bezier segments, flat gouache-like washes in a muted shared
palette, fills deliberately off-register from the linework, cream paper base,
hatched shadows). Intended to replace the poster-stylized Wikimedia Commons
photos baked into `../../snapback/shared/station-photos.gen.mjs`; unlike
those, these are original artwork and need no attribution line.

Format contract (matches how `model.mjs stationPhoto()` uses station art):

- `viewBox="0 0 640 1136"` portrait, full-bleed — rendered as the phone-screen
  background with the departure board overlaid on top.
- The top ~25% (y < 280) is kept compositionally calm so overlaid white board
  text stays legible; legibility scrims are the wrapper's job, not baked in.
- Fully self-contained: no external URLs, no raster data, no scripts, no CSS
  classes. Each file under 50 KB.
- No text or lettering in the artwork.

Naming: `<stationId>-<scene>.svg` where `<stationId>` matches `STATIONS` in
`../../snapback/shared/model.mjs` and scene is 1–3.

| Station | 1 | 2 | 3 |
| --- | --- | --- | --- |
| san-francisco | Golden Gate towers above fog | Cable car cresting steep hill | Ferry Building clock tower |
| twenty-second-st | Rail-cut staircases, train below | Steep street toward skyline | Pier 70 cranes, warehouses |
| bayshore | Butterfly canopies, brick roundhouse | Fog spilling over San Bruno Mtn | Candlestick marsh, windsurfers |
| south-sf | Sign Hill above the houses | Oyster Point masts, biotech glass | Grand Avenue brick storefronts |
| san-bruno | Elevated viaduct with palms | Jets stacked over rooftops | Sweeney Ridge trail, fog, bay |
| millbrae | Caltrain and BART under canopy | Jet climbing off bayside runway | Broadway toward green hills |
| burlingame | 1894 depot arcade, eucalyptus | Burlingame Ave awnings, shoppers | Bayfront path, kites, planes |
| san-mateo | Sunrise bay bridge, shorebirds | Tea garden pagoda, koi pond | B Street shopfronts, cafe tables |
| hayward-park | Bay Meadows racehorses, grandstand | Picnic lawn, rowhouses, Caltrain | Eucalyptus over bungalow street |
| hillsdale | Elevated canopy, train arriving | Golden oak hills behind rooftops | Mid-century strip, nose-in cars |
| belmont | Ralston Hall, formal lawn | Waterdog Lake chaparral canyon | Twin Pines creek footbridge |
| san-carlos | 1888 stone depot, witch's hat | Laurel Street evening diners | Hiller helicopter, prop plane |
| redwood-city | Courthouse dome over plaza | Port salt mounds, kiteboarders | Glowing marquee, evening crowds |
| menlo-park | Victorian depot, semaphore, oaks | Golden hills, winding oak road | Santa Cruz Ave shopfronts |
| palo-alto | Hoover Tower over Stanford roofs | HP garage behind picket fence | El Palo Alto, trestle, Caltrain |
| california-ave | Farmers market canopies | Stanford Dish on golden hills | Barron Park donkeys under oaks |
| mountain-view | Amphitheatre tent at dusk | String-lit Castro Street evening | Salt ponds, boardwalk, egret |
| sunnyvale | Murphy Avenue string lights | Apricot blossoms, water tower | Hangar One beyond wetlands |
| lawrence | Overpass arcing over Caltrain | Golden-hour tilt-up campuses | Apricot yard, sprinkler mist |
| santa-clara | 1863 depot and signal tower | Mission facade, palms, roses | Glowing stadium, dusk crowds |
| san-jose | Renaissance depot facade, palms | Light tower over Victorian roofs | Dusk skyline, arena, Caltrain |
