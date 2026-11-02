# Nested folder regions

Status: the scoped features are implemented behind the opt-in `nested` cluster mode: nested region geometry, whole-note containment, recursive framing and persistence, a reserved label band per region, an undrawn vault-root disc, and subtree hiding (S1–S3). Source: `src/regions.ts`, `src/layout.ts`, `src/camera.ts`, `src/hidden.ts`, `src/hidden-controls.tsx`, `src/graph-view.tsx`. M0–M3 remain the original implementation and validation plan; real-vault judgement and Hermes-webview profiling have not been completed. The **Validation status** and **Implementation record** distinguish those limits from implemented behaviour and historical measurements. Cost statements in the design sections are reasoning; the measurements are in the record.

## Problem

The original folder layout reflects only the first path segment of a note (`noteFolder` in `src/model.ts`). Each top-level folder gets one hue, one anchor on a ring and one legend toggle, applied through weak x/y forces. In that layout, subfolders have no representation and nothing stops a note from sitting among another folder's notes. Nested mode adds a folder hierarchy the user can explore in the graph: nested translucent regions behind the nodes, deeper levels revealed by zooming, one uniform interaction at every depth, and a layout in which a note is never partly inside a region it does not belong to.

## Non-goals

- Folder nodes or containment edges in the graph. Edges stay `[[wikilinks]]` only.
- Moving files by dragging nodes between regions.
- Changing the file tree.

## Behaviour before this work

The code as it was when this design was written; the nested mode changes none of it for the `folder` and `none` modes.

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
- Subtree hiding is specified in "Subtree hiding" below and is implemented.

Keyboard navigation of folders is not specified here; the existing arrow-key hop between linked notes is unchanged.

## Design

### Canonical folder tree

The full path hierarchy of the vault is the authoritative structure. `GraphNode` gains `dir` (the full folder path); `folder` stays for the existing top-level colour and legend. Nothing is dropped from the logical tree for being small or redundant. Simplification is presentation only:

- A chain of folders with no direct notes and a single child is drawn as one region labelled with the abbreviated path (`A/B/C`), and each folder in it still resolves to that region for hover and framing.
- Geometry-derived zoom limits make every note compartment reachable. Small regions are culled at the current zoom, not removed from the hierarchy. The synthetic vault root never merges into a real folder chain, even when the vault has only one top-level folder; that folder retains its own framing, breadcrumb and Hide action.

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
- A compartment can crowd even when its aggregate footprint fits its capacity bucket: summed area does not guarantee a non-overlapping arrangement under the forces and projection. Repacking on footprint-bucket changes (below) updates capacity but does not guarantee note separation.

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

**Graph layout** selects `folder`, `nested` or `none` (shown as "Cluster by folder", "Nested folder regions (notes stay inside their folder)" and "No clustering"). Keep `folder` as the default while the real-vault and host validation below remains outstanding. **Note labels** retains the existing `auto` default and `always`/`never` alternatives; it governs note labels, not folder labels, which are navigation controls and follow semantic zoom. Hidden paths and positions are per vault; layout and note-label preferences remain plugin-wide, as in `Prefs`.

Do not expose force strengths, density, packing padding, bucket ratio, label bands or zoom bounds as settings without evidence of a user task requiring them. Their current values support containment and navigation as a coherent layout; exposing them would shift tuning and invalid combinations onto the user. Camera framing respects the system's `prefers-reduced-motion` preference and jumps directly to its target when requested, without a separate plugin toggle. This preference does not stop the force simulation.

Keep subtree hiding reversible through the existing controls, with no confirmation dialog or undo preference. "Show all" clears graph-hidden paths only; it does not override skipped folders in the vault scan, local-graph selection or the unlinked-note filter. A solo mode and an on-canvas action remain outside this scope.

## Scaling

Symbols: N notes, E edges, F regions, V regions that pass the visibility test, P the sum of folder depths over distinct note directories. Costs below count path operations as constant; string copying and comparisons additionally depend on path length.

| Component | Cost | Caveat |
| --- | --- | --- |
| Folder tree and footprint buckets | O(N + P) before sorting on rescan | footprint aggregation scans notes; tree construction walks the ancestors of each distinct note directory |
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
- **Deferred.** Link-aware arrangement of sibling regions (needs a folder-level simulation whose cost and constraint satisfaction are not yet established); local-graph repacking; a grid-hash label pass; a spatial index for hit-testing; a worker for the simulation. Subtree hiding was deferred here and has since been implemented (see "Subtree hiding"). The measurements in the Implementation record found no cost knee up to the sizes tried (N up to 5000, headless Edge and Node, not the Hermes webview), so none of the deferred performance items is pursued without a measured problem on a real vault.

## Decisions

- Regions are discs, with no organic-outline fallback (see Rendering).
- Framing changes the camera only (see Interaction contract).
- Containment is a hard clamp with outward velocity removed.

## Validation status

The implementation and automated checks support containment, deterministic geometry, persistence, recursive framing and recovery from graph-hidden state. Generated-vault screenshots and the headless-browser exercise support the prototype's visual and pointer behaviour. The measurements below are historical results from Node and headless Edge, not a current Hermes-webview performance guarantee.

Real-vault judgement of density, label legibility, deep navigation and spatial continuity across repacks remains outstanding. Hermes-webview profiling is also outstanding, so there is no measured host cutoff or basis for enabling nested mode by default. No further performance machinery is justified by the recorded fixtures alone.

Host admission lint passes: `hermes plugins validate .` accepts the rebuilt bundle after `scripts/build.mjs` omits the optional CodeMirror `EditorState.tree` debugging getter. The getter was a pre-existing prototype mutation in `@codemirror/language`; the transform removes that mutation, preserves the normal `syntaxTree(state)` API and fails the build if the exact upstream statement changes. A bundle regression test guards its absence. This is static validation, not evidence of an interactive test in Hermes: the requested host smoke test remains unperformed because the session's UI access host is unavailable.

Keyboard support covers note navigation, current-folder hiding, Escape and HTML breadcrumbs/recovery controls. It does not provide discovery and descent into arbitrary child folders without a pointer. This is a remaining accessibility limitation, not a completed keyboard folder-navigation design; deciding how to expose the hierarchy to keyboard and assistive-technology users requires a separate interaction design rather than more numerical settings.


## Subtree hiding

Status: implemented (S1–S3; see "Subtree hiding: implementation notes" in the Implementation record). The text below is the specification; the facts it quotes about the code describe the code before the change: the graph hides notes whose top-level `folder` is in `hiddenFolders` (`filterGraph` in `src/model.ts`), the set is the per-vault `hiddenInGraph` list in `prefs.ts`, toggled by `store.ts` and surfaced only as one legend chip per top-level folder. Geometry is computed from the full graph, so hiding never moves a region, and a region with no shown note is already drawn faintly.

### Goal and constraints

Let the user hide any folder's subtree at any depth, and always see how to get it back. Constraints taken from the rest of this document: the map does not move when notes are hidden; the interaction is the same at every depth; every piece of persistent state has a visible control; an action never depends on a hover that the pointer must leave to reach the control.

### State

`hiddenInGraph` is interpreted as a set of vault-relative folder paths, persisted as the existing array of strings. For a non-empty entry `p`, a note is hidden exactly when `dir === p` or `dir.startsWith(p + '/')`: `A/B` must not match `A/BB`. Paths use the same separator and case semantics as `GraphNode.dir`; this feature adds no path rewriting. Existing top-level entries remain valid without migration. The empty path `''` matches only notes with `dir === ''`, not every folder. A region is identified by its deepest folder, so hiding a chained region `A/B/C` stores `A/B/C`; an existing entry for any ancestor in the chain still covers it.

Entries are stored as given and never normalised. Hiding `A` while `A/B` is already hidden keeps both entries; showing `A` later restores `A` but leaves `A/B` hidden, which is what the user last asked for about `A/B`. Hiding a path that an existing entry already covers adds nothing and is reported as "already hidden by A". Effective visibility is computed by testing a folder's ancestors against the set.

Showing an entry removes only that exact entry. It does not promise to reveal every note under it: other ancestor or descendant entries can still hide notes. For the path-bar action, choose the exact entry for the framed folder first, otherwise its nearest covering ancestor. If removing it leaves another covering ancestor, retain the hidden appearance, retarget the button and announce "Removed A/B; still hidden by A". This makes overlapping entries removable without silently clearing separately saved choices. "Show all" is the explicit operation that clears the entire set, including stale entries.

### Controls

- Hide or Show button, in the path bar beside the breadcrumb, acting on the camera's current folder, never on the hovered one. This is the explicitly framed region until manual navigation updates the current folder by the existing viewport-centre rule. The reason is the pointer: moving to a button outside the canvas clears hover, and the breadcrumb then reverts to the camera's folder, so a hover-targeted button would act on a different folder than the one the user pointed at. The workflow is therefore frame, then act, which also matches click-to-frame as the primary gesture. Always name the action's target with its full path even while the breadcrumb shows hover ancestry. The button is absent when there is no current folder or the vault root region is current; the root-notes legend chip controls `''`.
- The button's label and target follow the framed region's state: not hidden gives "Hide A/B" (n notes); hidden by its own entry gives "Show A/B"; otherwise the nearest covering entry gives "Show A". Show removes the named entry using the rules above; it can leave some or all of the framed subtree hidden.
- Keyboard: `H` on the focused canvas does the same as the button, including when no notes remain. Handle it before the existing note-navigation guard; ignore key repeat so holding it cannot toggle repeatedly. It accepts either case, does not run in text inputs and leaves Ctrl/Meta/Alt chords alone. Announce actions and residual ancestor coverage through an `aria-live` region ("Hid A/B, 12 notes"); no undo toast is required initially. Button and chip focus survive the update or move to the next recovery control when the activated control disappears; after the last recovery control is removed, focus returns to this graph's canvas or its focusable no-notes message.
- Legend: retain the existing root-notes and top-level chips. A "Hidden" group lists every saved entry not represented by those chips: deeper paths and stale entries at any depth, including a stale `''` entry. Each chip names the full path (or "Root notes" for `''`) and removes exactly its entry. Existing folders are determined from the unfiltered graph's folder tree, including intermediate folders; absence means "not in current scan", not proof that a filesystem directory was deleted. Mark absent entries dimmed with that wording, keep them operable, and retain them until explicitly removed. No entry is duplicated or left without a control. A "Show all" chip appears when there are two or more saved entries, even if some are redundant or stale.

Counts are the number of notes in the unfiltered scanned graph covered by that entry's path, before graph hiding, local-graph and orphan filters; search only dims notes today. For `''`, count direct root notes only. Label these as subtree totals, not the number newly hidden or restored by an action. Overlapping entries can count the same note, so their counts are not additive; a stale entry has zero notes. A top-level chip remains shown when only some descendants are hidden; its subtree count and the Hidden group expose those partial exclusions.

### On the canvas

A region covered by an explicit entry or a covering ancestor is drawn with a dashed outline and its label suffixed "(hidden)", distinct from the faint, solid look of a region that is merely empty or filtered out by local-graph or orphan controls. Search dims notes and does not itself make a region hidden. The hidden treatment follows saved path coverage, not an absence of visible notes: a parent whose descendants happen to cover all its notes keeps its normal look unless an entry covers the parent itself. Its disc keeps its place. Hidden regions and their descendants remain eligible for label drawing, hit-testing and framing under the existing semantic-zoom rules, independently of visible-note occupancy, including when every note is hidden. Measure and hit-test the suffixed label, and reset the canvas dash state before drawing other regions, edges or nodes.

### Effects on the rest of the system

- Filtering: `filterGraph` replaces the top-level lookup with an ancestor test, memoised per distinct `dir` for the duration of one filter call, so the added work is proportional to the number of distinct folders times depth plus one lookup per note. This is reasoning, not measurement.
- Layout: hidden notes leave the simulation exactly as hidden top-level notes do today. Surviving notes retain their starting positions on rebuild but can settle differently after forces and links are removed or restored; no promise of frozen note positions is made. Region geometry, compartment placement, current folder and camera do not change, and no repack or automatic fit occurs.
- Local graph and search: the hidden set applies in every view. A hidden note never appears, including in the local graph. If the open note is hidden, it stays open in the editor and simply has no node, as today for hidden top-level folders.
- Modes: path entries filter in all cluster modes. The Hide and Show button needs regions and so exists only in nested mode, but the Hidden group is shown in every mode so state set in nested mode stays recoverable.
- Empty result: hiding all displayed notes keeps the nested canvas, path bar and recovery controls mounted; root-notes and top-level chips can be the only recovery controls when no deeper entries exist. If the unfiltered scan itself becomes empty, the current workspace replaces `GraphView` with a no-notes message; recovery controls must remain available alongside that message so stale state can still be cleared. Recovery does not depend on region geometry or a non-empty simulation.

### Tests

- Model: segment-boundary matching (`A/B` versus `A/BB`), root-only `''` semantics and legacy entries; ancestor and descendant entries coexist; showing either removes only that entry; exact then nearest-ancestor targeting with residual coverage; a chained region hides its subtree and resolves entries for intermediate ancestors.
- Store: hiding adds an uncovered path and is a no-op for an already covered path; showing removes only its named path; persistence round-trips; stale entries survive scans; Show all clears every entry.
- View: the button targets the current folder despite hover ancestry and after manual camera navigation; labels and announcements reflect residual coverage; `H` and the button agree with zero displayed notes and ignore repeat; every saved entry has one control, including stale top-level and root entries in all modes and after an empty scan; subtree counts remain stable across filters and overlap; hidden labels remain frameable and dashed styling does not leak; hiding changes neither geometry nor camera. Verify recovery focus after removal of a chip.

### Milestones

- **S1, state and filter.** Path set in `model.ts`, `store.ts`, `prefs.ts`; tests above for model and store.
- **S2, controls.** Path-bar button, `H`, recovery controls in `graph-view.tsx` and the empty-scan branch of `workspace.tsx`, and the dashed hidden-region look; view tests, including empty-state recovery.
- **S3, documentation.** README and a screenshot of a hidden subtree with the Hidden group.

### Decisions

1. No undo toast initially. Persistent legend recovery and the path-bar Show action suffice for reversing a hide; an additional transient affordance is not needed for the scoped interaction. Decided.
2. A "solo" action (show only this folder's subtree) is not built. It is a different state, a single shown path rather than a hidden set, and would need its own persistence and recovery control. Not built; specify before building.
3. The Hide and Show button lives in the path bar only. It is accessible and keeps the canvas free of hit-test conflicts. Decided.

## Implementation record

Resolved by the implementation (the design above stands unless noted):

- **Packing.** `d3-hierarchy` (`packSiblings` front-chain, `packEnclose`; ISC, 3.1.2) is the one added dependency: it is the established deterministic implementation of the algorithm named in the design. Children are sorted by radius then path before packing; each child is inflated by a fixed padding (8) for the packing, so siblings keep a gap of at least twice that and children keep that margin from the parent edge. A folder whose only child is its own compartment is that compartment; a folder with no notes and one child is that child (a chain), without extra padding.
- **Root region.** The synthetic vault root stays distinct in the geometry (it holds the top-level packing together and anchors the whole-map camera fit and the breadcrumb) but its disc is not drawn: it only encloses the top-level folders and added clutter. With exactly one child and no direct notes, it shares the child's bounds without an extra padding or label band; real folder chains still merge below it. The root's own compartment is drawn separately when it has child folders; in a root-notes-only vault the root disc remains undrawn.
- **Label band.** A region disc is its content disc (the packing's enclosure, or the compartment for a leaf) grown by 14% of the content radius, with the content pushed down to touch the bottom edge. The crescent above it is reserved for the region's own label, so no note or child region can lie under a label. An unforced label is drawn only while its box (at screen-constant size) lies wholly outside the content disc at the current zoom, so a label that does not fit at a given zoom is hidden, not overdrawn; the hovered or framed region always labels. The root region has no band. The geometry tests assert that content lies inside the region, touches its bottom edge, and holds all children and the compartment.
- **Geometry identity.** A compartment's radius is its direct notes' summed collision footprint (π(r+4)²) rounded up into geometric buckets (area ratio 1.5), over a packing density of 0.4, and at least the largest note's collision radius. `graph-view` rebuilds geometry only when the sorted (folder, radius) list changes; it is computed from the `fullGraph` prop, not the displayed graph.
- **Camera.** Zoom limits (`zoomLimits`) are the legacy 0.1–6 widened by the whole-map fit (floor) and the smallest-compartment fit (ceiling), recomputed on every use so they follow the viewport; the 1.8 cap applies only to the global Fit and the whole-map crumb. Framing animates along the van Wijk–Nuij smooth zoom path (d3-zoom's `interpolateZoom`), which zooms out and back in over long jumps. The "current folder" is the framed region, and after a manual pan or zoom the deepest region containing the viewport centre whose on-screen radius is at least a quarter of the viewport's short side; Escape frames its parent. A viewport resize while still framed re-frames the same region. In nested mode the camera is kept through filters, the local graph and repacks, and refit only on first display or a mode switch.
- **Path display.** One HTML breadcrumb (Vault / A / B / C). It shows the hovered region's ancestry (a hovered note shows its folder's) and otherwise the camera's; steps are buttons that frame that ancestor. Hover emphasis: the chain brightens, other regions recede.
- **Semantic zoom.** A region is drawn and hit-testable once its on-screen radius is at least 14 px, and labelled at 40 px or more only while the label fits in the label band (below); traversal skips subtrees that miss the viewport or fall below the band; a disc that covers the whole viewport is not drawn. No region is too small for every reachable zoom (the ceiling is the smallest compartment's fit), so presentation simplification is only chain merging.
- **Containment.** `containNode` clamps the position (and any `fx/fy` pin target) to the compartment less the note radius and removes outward normal velocity. It runs at build (seeding, restoring, remapping, radius change), in the `tick` handler and when pins change, and the drag target is clamped before it is written. Harnesses must call `step()` (`sim.tick()` dispatches no event); a test shows that bare `sim.tick()` violates containment on a cross-linked fixture.
- **Persistence.** `VaultState.nestedPositions` stores `[folder, u, v]` (offset over radius) and survives repacks by mapping and then containing; a note whose stored folder differs from its current one is seeded fresh. `positions` gains `positionsMode`; positions with no recorded mode (saved before this change) are accepted by folder/none as they always were and never by nested, and positions of a different mode are replaced, not merged. Live positions carry over only within the same mode. Pins are a mode-independent set: a pin from another layout is re-applied at the note's seeded or restored position, then clamped like any `fx/fy`. Cold-start seeding inside a compartment is a deterministic sunflower spiral (no jitter, no randomness).
- **Forces (nested only).** Boundary crowding was measured before choosing (`node scripts/bench.mjs`; 600 notes, depth 3, 300 settled steps; share of notes in the outer 5% of compartments with at least 8 notes). With the folder-mode forces (pull 0.07, repulsion range 340) 61% sat on the rim with internal links only, 69% with 10% cross-folder links and 83% with no links at all, so the pile-up exists without external links and comes from the repulsion/pull balance, not cross-folder tension. Lower compartment density alone helped little (density 0.15: 29% / 47% / 75%). Shortening the repulsion range to 60 and pulling at 0.25 gave 4% / 30% / 43% for internal-only / 70% cross-folder / no links. Cross-folder links add a separate tension, so nested mode weakens them to 0.1 (folder mode keeps 0.3), giving 3% / 24% / 58% / 43% for internal-only / 10% cross / 70% cross / no links. Link-aware sibling arrangement was not needed and remains deferred. The folder and none modes are unchanged.
- **Settings and help.** `ClusterMode` gains `'nested'`; **Graph layout** names all three choices, and **Note labels** makes clear that the label preference does not remove folder navigation labels. The nested option text and canvas tooltip/aria-label explain containment; the help also exposes Hide/Show and `H`. Camera framing honours the system reduced-motion preference.

Measured with `node scripts/bench.mjs` (Node 24) and `node scripts/bench.mjs paint` (headless Edge, the real `GraphView`, 1400×880) on the development machine. The Hermes webview was not available, so these are not host measurements and no cutoffs are set from them. Manual `sim.tick()` means over 60 ticks, nested against folder mode: forces cost the same (N=500: 1.4 vs 1.8 ms; 2000: 8.5 vs 8.3; 5000: 26 vs 28; folder-per-note N=1500: 5.7 vs 6.3). The projection adds 0.03 ms (N=500) to 0.4 ms (N=5000) and 0.3 ms at folder-per-note N=1500. Geometry takes 0.4–1.1 ms for up to 5000 notes in 40–121 regions and 9.6 ms for 1540 regions. Paint medians, folder against nested: during the settle 1.0 vs 1.2 ms (N=1000) and 2.9 vs 2.8 ms (N=3000); while zooming 2.0 vs 2.5 ms and 4.1 vs 3.2 ms; folder-per-note N=1000 nested 1.6 ms settling and 3.1 ms zooming. At these sizes the simulation, not the regions, dominates; no knee was found within them, and larger vaults were not measured.

Prototype evidence: (1) compartments crowd their edges under the folder-mode forces, and the fixture comparisons identify the force balance as a cause (above); (2) bucket ratio 1.5, density 0.4 and padding 8 were judged on a generated 220-note, 3-level vault (`docs/screenshots/nested-folders-*.png`), not on a real nested vault; (3) navigation across depths and outward worked in headless Edge with mouse and keyboard input (click a label at each depth, Escape and path steps back out), and a resize keeps the framed folder in the component tests; repack continuity rests on the offset mapping and its tests, not on a visual judgement over time.

### Subtree hiding: implementation notes

- **Where.** `src/hidden.ts` holds the pure path semantics (`covers`, `coveringEntry`, `hidePath`, `showPath`, `subtreeCount`, `knownFolders`); `filterGraph` tests a note's `dir` against the set through `isHiddenDir`, memoised per distinct folder per call. `VaultStore` gains `hideInGraph` (returns what already covered the path), `showInGraph` (exact entry only) and `clearHiddenInGraph`; `toggleFolderInGraph` now delegates to them for the legend chips. `src/hidden-controls.tsx` renders the Hidden group and "Show all" and is used by both the graph legend and the empty-scan message in `workspace.tsx`.
- **Target.** The path-bar button and `H` act on the camera's current folder; the label names the full path and the state (Hide with the subtree note count, Show for the folder's own entry, else Show for the deepest covering ancestor entry). `H` is handled before the note-navigation guard, ignores key repeat and Ctrl/Meta/Alt chords, and does nothing outside nested mode. Results and residual coverage are announced through a polite live region.
- **Canvas.** Coverage is computed per region from the saved entries, not from occupancy. A covered region and its compartment get a dashed outline (drawn at full outline strength so it reads while the fill stays faint) and the label suffix "(hidden)", which is measured and hit-tested like any label; the dash state is reset after each stroke. The vault root disc is not drawn, but the root-notes compartment follows the `''` entry.
- **Recovery.** Entries equal to a top-level legend chip stay on that chip; every other entry, deeper or stale at any depth including `''`, is a chip in the Hidden group with its subtree count (stale ones dimmed and marked "not in current scan"). Removing a chip moves focus to the control that takes its place, else to the graph. The scan-empty message renders the same group, so stale entries can be cleared when no notes exist.
- **Tests.** `src/hidden.test.ts` (segment boundaries, root-only `''`, legacy entries, coexisting ancestors and descendants, targeting, counts), store tests (covered no-op, exact removal, stale entries surviving a rescan, Show all), `graph-view.test.tsx` (button targets the camera folder rather than a hovered one, `H` agrees with the button with zero displayed notes and ignores repeat, residual-coverage announcements, dashed and labelled hidden regions that can still be framed, no dash leak, Hidden group in folder mode with counts and stale entries, focus after removal) and `workspace.test.tsx` (recovery beside the no-notes message). A test-isolation note: view tests that render must `await settle()` before ending, or a pending d3 timer from the unsettled simulation leaks into the next test.
- **Screenshot.** `node scripts/screenshots.mjs hidden` renders `docs/screenshots/hidden-folders-*.png` from the generated vault with two hidden subtrees and one stale entry.

### Rim crowding, label reach and focus rescans (second pass)

A live vault showed notes hugging compartment rims. Measured with `demo/bench.ts`: plain repulsion alone leaves 44% of notes on the rim, and cross-folder links (a pull proportional to a distance of hundreds) beat the centring pull. Cross-folder link strength is now 0.03 and an inset spring (`forceInset` in `src/layout.ts`) eases notes off the rim beyond half the usable radius; the hard projection remains the guarantee. Layouts saved before this change settle inward gently on the next warm start rather than being reset.

Region labels were limited by the crescent fit (about 60px region radius for 11px text), not by `LABEL_MIN_PX`, so lowering that constant alone changes nothing. Labels now shrink to 9px with the region, and from `LABEL_MIN_PX` (20) a label that still does not fit the crescent is drawn haloed over the region's top, allowed to overlap a few small notes; notes keep pointer priority over it.

Every window focus triggered a full rescan that built a new graph object, which rebuilt the simulation (warm settle, position write-back). `VaultStore.graphFor` now returns the previous graph when the rebuilt one is identical (`sameGraph`), so a rescan that found nothing new leaves the layout alone.
