# Nested folder regions: proposal

Status: proposal, nothing implemented. Statements about the code were checked against `src/model.ts`, `src/graph-view.tsx`, `src/prefs.ts` and d3-force. Statements about cost are reasoning, not measurement, and are marked as such; milestone 0 replaces them with measurements.

## Problem

The graph reflects only the first path segment of a note (`noteFolder` in `src/model.ts`). Each top-level folder gets one hue, one anchor on a ring and one legend toggle, applied through weak x/y forces. Subfolders have no representation and nothing stops a note from sitting among another folder's notes. The goal is a folder hierarchy the user can explore in the graph: nested translucent regions behind the nodes, deeper levels revealed by zooming, one uniform interaction at every depth, and a layout in which a note is never partly inside a region it does not belong to.

## Non-goals

- Folder nodes or containment edges in the graph. Edges stay `[[wikilinks]]` only.
- Moving files by dragging nodes between regions.
- Changing the file tree.

## Relevant current behaviour

- `paint` redraws everything on canvas 2D on every simulation tick, hover change, pan and zoom, with a label pass that scans placed labels linearly. `hit` is a linear scan over nodes.
- Simulation and paint share the main thread. d3-force dispatches `tick` after a step has applied the forces and integrated, and the plugin's handler only schedules a paint, so timing that handler does not measure force computation.
- Pointer drag writes arbitrary `fx/fy` onto the node and d3 reapplies them each tick; pinned nodes keep their `fx/fy`.
- On a rebuild, a node's position comes from the live node of the previous simulation first, then from persisted `positions`, then from a jittered anchor. A warm start (over 80% restored) runs a gentle settle.
- Persisted `positions` are per vault and carry no layout identity.

## Interaction contract

Every folder region presents the same interaction at every depth, so the hierarchy is learned once and applies recursively.

- Hover on a region (its label or its empty area, not a note) identifies it: the region and its ancestor chain are emphasised, shown as a path (`A / B / C`), and unrelated regions recede. Hover on a note keeps its current behaviour and additionally shows its ancestor chain.
- Click on a region label frames that folder: the camera animates to fit the folder's disc. Its subfolders become visible because the zoom now puts them in their visibility band. Framing changes only the camera; it adds no persistent dimming or other focus state, so it composes with note selection, search and hover and does not obscure cross-folder links. Persistent emphasis is added only if the prototype shows that the path display and camera position give too little orientation.
- Framing and manual zoom share geometry-derived limits that cover both ends of the hierarchy. The zoom floor is the smaller of the current floor (0.1) and the magnification needed to fit the whole map; the ceiling is the larger of the current ceiling (6) and the magnification needed to fit the smallest compartment holding a note. Compute these fits with viewport padding, update them on geometry or viewport changes, and handle empty geometry and zero-sized viewports without invalid values. The existing 1.8 cap remains specific to the global Fit action; it does not cap folder framing. Whole-map and folder framing respect the shared limits and centre the requested region.
- Going outward is the same gesture on the ancestor: click an element of the displayed path to frame that ancestor, or press Escape to frame the parent of the currently framed folder. The path display is the persistent way back out.
- Notes keep their actions: click opens, Shift+click pins, drag moves. Pointer priority is note, then region label, then region area; a drag that starts on an empty region area pans as it does today, and a click there does nothing.
- Subtree hiding is deferred. It is not part of the contract until a reversible control for it is specified.

Keyboard navigation of folders is not specified here; the existing arrow-key hop between linked notes is unchanged.

## Design

### Canonical folder tree

The full path hierarchy of the vault is the authoritative structure. `GraphNode` gains `dir` (the full folder path); `folder` stays for the existing top-level colour and legend. Nothing is dropped from the logical tree for being small or redundant. Simplification is presentation only:

- A chain of folders with no direct notes and a single child is drawn as one region labelled with the abbreviated path (`A/B/C`), and each folder in it still resolves to that region for hover and framing.
- A region too small to be legible at any reachable zoom is not drawn separately but remains in the tree and in the ancestor path of its notes.

### Region geometry: static, deterministic, bottom-up

Geometry is a pure function of the folder tree and per-compartment footprint buckets (see Visibility changes and stability), computed from the whole vault and not from what is currently visible.

1. A folder's direct notes form a compartment disc, a sibling of its subfolder discs. The compartment radius comes from the bucketed aggregate footprint of its direct notes (footprint area over a packing density), and is at least that of the largest note. A note's region is its folder's compartment, never the folder disc. This keeps a note of `A` out of `A/B`.
2. A folder's disc is built bottom-up: pack its children (the compartment disc and each subfolder disc, whose radii are already final) without overlap using a deterministic circle-packing procedure with fixed tie-breaking, take the enclosing circle of the packing, and add padding. Parent radii therefore come from the packing, not from counts: for example two equal children of radius r need a parent of at least 2r, whereas an area-additive rule gives only √2·r and the children would not fit.
3. Packing is deterministic given its input (sorted paths, footprint buckets), so geometry can be recomputed rather than stored.
4. Geometry is stationary while notes settle. No simulation moves regions; this removes the need for a second simulation, and with it the question of whether sibling collisions stay satisfied after children are clamped into parents.

Consequences: sibling regions are disjoint and children lie inside parents by construction, which are the guarantees about regions. Link-aware arrangement of sibling regions (placing heavily cross-linked folders adjacent) is deferred; the first version arranges siblings by the packing alone.

### Note layout and what is guaranteed

Notes keep the current link, charge and collide forces. The anchor force becomes a soft pull toward the centre of the note's compartment. After each step a projection clamps every note to its compartment disc less the note radius and removes the note's outward normal velocity component at the boundary; clamping position while keeping that velocity would make every following step push against the same constraint. The many-body repulsion is kept, and it also pushes notes outward, so a compartment can crowd its edge without any external links.

- Guaranteed: every note is inside its compartment at the end of each step, so no note is inside or straddling another folder's region. This is checkable per tick.
- Containment also holds before the first paint after seeding, restoration, a repack or a radius change. For compartment centre c, radius R and note radius r, require distance(x, c) <= R - r. If u = (x - c) / R is the stored offset, its allowed norm is at most 1 - r/R, not 1. Reapply the same containment operation to mapped positions and pin targets before they are drawn or applied as fx/fy; normalisation alone does not preserve whole-note containment when R shrinks or r grows. A note with R = r is placed at the centre; compartments must never have R < r.
- Best effort: separation between notes. d3's collision is a soft velocity correction and the projection can bring notes closer than their radii; the spec does not promise non-overlap between notes.
- Cross-folder links cannot pull notes together past a compartment boundary. If notes pile at boundaries, the prototype distinguishes causes before any remedy: compare otherwise similar compartments with internal links only against ones with many external links. Pile-up in both points to insufficient compartment capacity or the repulsion/pull balance, fixed by compartment sizing and force tuning; pile-up only with external links points to cross-folder tension. Reduced strength for cross-region links and link-aware sibling arrangement are considered only after that, in that order, because the latter adds substantial complexity without guaranteed relief.
- A compartment holding more notes than fit at their radii is possible when counts are quantised or notes are added before a repack. The projection still holds them inside; they crowd. Repacking on count growth (below) bounds this.

### Drag and pin

Because d3 reapplies `fx/fy` each tick, hard containment requires constraining those values, not only the simulated position.

- While dragging, the pointer target is clamped to the note's compartment before it is written to `fx/fy`.
- A pin is stored as an offset from its compartment centre, normalised by the compartment radius, and converted to `fx/fy` on application, so a pin follows a repack. Clamp the converted target for the current compartment and note radii before applying it, as specified above. Existing absolute pins from other modes are clamped when first applied in nested mode.
- Dragging a note out of its compartment is not possible; this is the cost of the guarantee and should be stated in the UI help.

### Visibility changes and stability

- Filters, legend toggles and search do not change geometry. Hidden notes are not drawn and their compartments stay; a region with no visible notes is drawn faintly or not at all, but never repacked.
- The local-graph toggle also does not repack in the first version: it draws the same map with fewer notes. A repack for local graphs is a separate behaviour to design deliberately.
- Geometry is recomputed only when the folder tree or a compartment's capacity bucket changes. Capacity is the aggregate collision footprint of the compartment's notes, not their count: node radius is `3 + 1.7·√degree` (`radiusOf`), so equal counts do not imply equal footprints, and a change in links can change a footprint without changing any count. The footprint sum is rounded up into geometric buckets, so adding a note or a link usually does not move the map, and every compartment is at least large enough for its largest note. Bucketing is a pure function of the current footprint, with no hysteresis, so geometry stays reproducible from the current paths and footprints; the cost is that a value near a bucket boundary flips geometry when it crosses. The bucket ratio is an internal constant tuned visually, not a setting.
- When geometry changes within nested mode, notes keep their positions relative to their compartment: nested-mode positions are stored and carried as a compartment path plus an offset from the compartment centre normalised by its radius. A repack therefore scales and translates a folder's notes with it and needs no copy of the old geometry.

### Persistence and cache validity

Persisted `positions` gain the layout mode. Two sources must be validated against it:

- Persisted positions are used only when their mode matches the current mode.
- Live positions carried over from the previous simulation are used only when the previous simulation had the same mode. Today they are preferred unconditionally, so switching mode would otherwise carry over positions from the old layout and place notes outside their new compartments.

A mode mismatch is a cold start: positions are discarded and notes are seeded inside their compartments with no jitter outside them. A change of geometry within nested mode is not a cold start, because nested positions are compartment-relative (above) and are mapped onto the new geometry. A note whose compartment no longer exists (the file moved folder) is the only per-note cold start. Because geometry is reproducible from the folder paths and footprint buckets, no geometry is stored.

### Rendering

- Regions are drawn first, beneath edges and nodes: a circle path per region, fill alpha decreasing with depth, hue from the top-level folder with lightness stepped by depth, a faint outline. Discs are the decision, not a provisional choice: the drawn boundary is the containment boundary, so a region never visually contains a note it does not own and never suggests an overlap that does not exist, and the geometry is static and known, so drawing needs no per-node work and has no frame-to-frame shape change. Spacing, padding, opacity and transitions are tuned before the shape is questioned.
- Semantic zoom: a region is drawn while its on-screen radius lies in a band. Below the band it is clutter; above it the region has outgrown the viewport and only the outline is drawn. A region's children are visited only if the region intersects the viewport and is large enough on screen to have visible children, so traversal skips whole subtrees rather than testing every region.
- Region labels are drawn at screen-constant size and compete with note labels for placement, region labels first. The hovered or framed region always labels.

### Settings

Add `'nested'` to `ClusterMode` (currently `'folder' | 'none'`). The existing modes keep their current layout and behaviour; the feature is opt-in until measured.

## Scaling

Symbols: N notes, E edges, F regions, V regions that pass the visibility test.

| Component | Cost | Caveat |
| --- | --- | --- |
| Folder tree and footprint buckets | O(N) on rescan | |
| Packing | per bottom-up step, depends on the packing algorithm; the front-chain method is quadratic in children in the worst case | one-off per change of tree or bucket; F is usually far below N |
| Per-note pull and projection | O(N) per tick | same order as the existing x/y forces |
| Region draw | O(V) per paint plus the traversal that finds V | traversal visits regions that intersect the viewport and survive the size test; worst case is all of F |
| Region labels | adds candidates to the existing label pass | a grid hash makes placement fast when label density per cell is bounded; it is not linear in general, and the rewrite is deferred unless M0 shows the pass matters |

What follows from the design, as reasoning:

- With static geometry and no folder simulation, per-tick work added is the pull and projection, and per-frame work is region draws. Which of these matters relative to the existing O(N log N + E) simulation and O(N + E) paint depends on constants this document has not measured, so no ratio is claimed.
- Hulls would put every note in as many regions as its depth; discs do not.
- Folder-per-note vaults make F close to N, so region draw and traversal approach the cost of node draw. Drawing only regions that pass the size test bounds this at any single zoom, not in aggregate.
- Rebuilds triggered by filters and toggles do not repack, which also keeps them cheap and keeps the map from shifting.
- Possible instability to watch: nodes crowding compartment edges under heavy cross-links, and the projection fighting the link force so the simulation stays warm and the paint loop keeps running. The projection is not a force, so `alpha` still decays, but this should be checked in M0 and M2.

Degradation, if measurement shows a cliff: draw regions only on settle while the simulation runs; shrink the visibility band; fall back to `'folder'` mode above a cutoff chosen from the measured knee.

### Measurement (milestone 0)

- Generate synthetic vaults with controllable N, E, depth, branching, folder-size skew, cross-folder link fraction, and a folder-per-note case, extending `demo/make-vault.mjs` or alongside it. The demo vault is too small to show cost.
- Attribute cost to forces, projection and paint separately. Do not time the `tick` handler. In the harness, stop the simulation's timer and call `sim.tick()` manually in a timed loop, and wrap the projection and `paint` in `performance.now()`; confirm with a profiler capture in the Hermes webview.
- Record baseline for the current code first, then each added component, so the knee for N, E, F and depth is read from data and the cutoffs are set from it.

## Milestones

- **M0, measurement.** As above, on current code.
- **M1, model and geometry.** `dir`, canonical tree, footprint buckets, deterministic bottom-up packing. Tests: on randomly generated folder trees, siblings are disjoint, children lie inside parents, repeated computation yields identical geometry, chains abbreviate while every folder resolves.
- **M2, interactive prototype.** Static regions drawn, functional region labels and hit-testing, per-tick projection, drag clamping and compartment-relative pins, hover ancestry, click-to-frame, shared geometry-derived zoom limits and path/Escape to go outward. Include enough semantic zoom to reveal children during recursive navigation; navigation across depths must be usable in M2, not deferred to M3. Judge the feel on a real nested vault before more is built. Invariant tests check containment before the first paint after seeding or remapping and after every step, including mid-drag, after a pin, after a shrinking repack or note-radius growth, after a rebuild and after mode switching, not only after settling. Check framing both the whole map and deep folders, including after viewport changes.
- **M3, rendering polish, persistence and settings.** Refined visibility bands and traversal culling, label-placement polish, `'nested'` mode, mode-validated, compartment-relative positions (both live and persisted), README and screenshots, then re-measure against M0 and set cutoffs.
- **Deferred.** Link-aware arrangement of sibling regions (needs a folder-level simulation whose cost and constraint satisfaction are not yet established); subtree hiding with a reversible control; local-graph repacking; a grid-hash label pass; a spatial index for hit-testing; a worker for the simulation.

## Decisions

- Regions are discs, with no organic-outline fallback (see Rendering).
- Framing changes the camera only (see Interaction contract).
- Containment is a hard clamp with outward velocity removed.

## Left to the prototype

1. Whether compartments crowd their edges on real vaults, and the cause if they do (see Note layout). The experiment is the internal-only versus many-external-links comparison; the remedies are ordered there.
2. The bucket ratio and padding. Start with an upward-rounded geometric bucket and tune by eye on a real nested vault; look for both frequent map shifts and visibly empty compartments.
3. Whether the spatial map stays recognisable across repacks. This, and the continuity of framing and zooming across depths, is what M2 is meant to judge; it matters more to the feel than boundary shape or folder-level forces.
