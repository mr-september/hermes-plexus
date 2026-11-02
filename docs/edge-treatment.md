# Edge treatment in the nested graph

Status: proposal, nothing implemented. Written after the nested regions shipped (see [nested-folder-regions.md](nested-folder-regions.md)), when the live vault showed that edges, not regions or notes, now dominate the picture. Revised after review; the first increment is E1 plus conservative viewport culling plus an edge show/hide toggle, in nested mode only. E2 and E3 are deferred, and batching is evaluated as a deliberate visual change.

## Context and motivation

Today every edge is one straight line, 1 screen pixel wide, painted over the region discs and under the notes (`draw` in `src/graph-view.tsx`). Each edge is stroked separately with `globalAlpha` 0.35 multiplied by the theme token `--ui-stroke-secondary` (fallback `#8885`), which may itself carry alpha; on hover the focused note's edges go to alpha 0.9 in the accent colour and the rest to 0.08. That treatment was designed for the flat layouts, where distance already encodes locality. In nested mode it has three problems, all visible in the live screenshot:

1. **Cross-region edges form a haze over the map.** In nested mode a note's edge to another top-level folder crosses region boundaries and the empty space between discs. These edges are the long ones, they are the majority in a densely cross-linked vault, and they paint over the discs that are supposed to carry the structure. Intra-folder edges, which explain a compartment's internal arrangement, are short and drowned out by them.
2. **The layout no longer needs cross-folder edges to be strong.** Cross-folder link strength was cut to 0.03 so they stop dragging notes to the rim. Those edges are now almost purely visual: they say "A and B are related" without influencing position. A purely visual channel can be encoded more compactly than one line per link.
3. **Cost is per edge, per frame.** The paint loop does `beginPath`/`stroke` for every edge on every tick and every pan/zoom frame. Cost is unmeasured in the Hermes webview; the paint bench (headless Edge) is the place to measure it, but its defaults (two links per note, 10% cross-folder) are far sparser than the motivating vault, so a dense case must be added before drawing cost conclusions.

## Edge classes

Three exhaustive classes, evaluated in order, from the two notes' `dir` and `folder` alone (no tree walk):

| condition, in order | class |
|---|---|
| same `dir` (including `''`) | same compartment |
| different `dir`, same non-empty `folder` | within top-level folder |
| otherwise (different top-level folders, and root note ↔ folder) | across top-level structure |

Note that `A` ↔ `A/B` is "within top-level folder" (same `folder` `A`), and a link between a root note and any folder note is "across", even though it does not cross two top-level containers.

The lowest common ancestor of the two folders is not needed for these classes. It stays available as metadata for later zoom or aggregation work, with three distinctions to keep straight if it is used: logical depth, displayed depth after chain collapse, and tree-path length. None of them equals the number of region boundaries a straight segment actually crosses, since a line can pass through unrelated discs.

## First increment

### E1. Tier the style by class (nested mode only)

- **Same compartment:** tinted with the folder's top-level hue, so the edge reads as part of the region.
- **Within top-level folder:** the same hue, lighter.
- **Across top-level structure:** the faintest, neutral. Endpoint-source hue is rejected: in an arrowless display it would arbitrarily privilege one endpoint. A neutral colour also lets the class be drawn as one path.

"Keep the current weight" is not a number to copy. Today's appearance is `globalAlpha` times a theme colour that may carry its own alpha; replacing it with an opaque HSL at 0.35 could make local edges substantially stronger. Calibrate the tinted classes against the existing composite in both themes, comparing the same settled scene before and after, not the alpha constants.

The tiers apply in nested mode only. Whether to port them to the non-nested layouts is a later decision.

The rationale is to apply the visual hierarchy the regions already establish: structure first (discs), local relations second, global relations third.

### Interaction precedence

1. Edges Off suppresses all edges, including a focused note's.
2. Otherwise a focused note's incident edges override the tier and any fade, and are painted last, on top. The focus order is unchanged: hover, then keyboard cursor, then the selected note.
3. Local-graph mode bypasses the tiers (every edge at full strength). The reason is that the user asked for exactly those relationships, not that a neighbourhood is necessarily small.

Hidden-folder filtering is unchanged: the model has no note-to-region edges, so a hidden folder's notes and their edges are simply absent.

### Reciprocal links

`buildGraph` keeps A→B and B→A as separate edges (its key is directional), so today they are two coincident strokes, which accumulate to about 0.58 where one edge is 0.35. Mutual links therefore look stronger by accident, not by design. Proposal:

- **At rest, draw one undirected line per linked pair.** Deduplicate for drawing (the model and link counts are untouched). Direction is not encoded in the overview: the graph has no arrowheads today, arrowheads at this density are clutter, and the dominant question in the overview is "are these related", not "who links to whom". A mutual link no longer looks stronger; that loses nothing the reader was meant to see.
- **On focus, distinguish three kinds of incident edge**, since only the focused note's few edges are drawn emphatically: outgoing (accent), incoming (a second tint, such as a dimmer accent), and mutual (both tints, or the accent with a thicker line). This is cheap (incident edges only), is where direction is actually useful ("what does this note cite, what cites it"), and agrees with the backlinks the note pane already shows.
- Deferred, since it needs a colour decision and a legend: the focus-time distinction can be skipped in the first increment, leaving the dedupe alone.

### Viewport culling

Skip an edge whose segment cannot touch the viewport, tested on the segment's bounding box grown by a stroke-width margin. Endpoint tests alone are not enough: a segment with both endpoints outside the viewport may still cross it, and must still be drawn. Culling is independent of the style work and of batching. Zoomed in, most edges are off screen, so this is the larger saving there.

### Edge show/hide control

A two-state control in the graph toolbar next to the layout and labels toggles: edges shown or hidden. Hiding is useful for very large vaults and for reading the structure alone. A third state (`Auto`, zoom-dependent) is added only when zoom-dependent behaviour exists; shipping three states now would leave two of them identical.

### Batching: a visual decision, not a free optimisation

Stroking many separate translucent paths accumulates opacity where they cross or coincide; subpaths within one stroked path are painted as a union (HTML canvas specification, `stroke()`). Batching edges into one path per style class therefore removes the accumulation. That may well be what clears the haze (a dense crossing no longer darkens toward opaque), but it is a rendering change that also flattens the cue that many edges pass through the same place. Evaluate it as one: render the same settled scene both ways in both themes and judge the images. A canvas-call assertion cannot validate that, only that one stroke per class was issued. It also reduces per-frame cost, which is measured separately on a dense case.

## Deferred

### E2. Zoom-dependent edge visibility

Not specified enough to build. A visibility rule needs more than an edge's LCA: it needs the region geometry, the zoom, and the viewport position and size (the `covers` test depends on all of them). Folder scale is also not endpoint visibility: a folder can hold a small direct-note compartment next to large descendant regions, so its radius says little about whether its direct-note edges are readable, and panning at fixed zoom can change the relevant context entirely. If E1 does not suffice, define E2 by explicit cases (overview, a framed folder, a deep compartment, a viewport straddling siblings), with continuous fades and the focused note's external connections preserved. Reusing the label thresholds is a possible starting point, not a demonstrated correspondence.

### E3. Bundling across top-level structure

For graphs where E1 still leaves a hairball, the options are:

- **Ribbons between sibling regions**, width growing with the log of the edge count, expanded on hover or when the camera enters an endpoint region. They need more semantic design than a first look suggests: a root's direct-note compartment is not a child folder region; counts must respect filtering; reciprocal edges need a counting convention; hover expansion must not double-represent; and a straight ribbon can still cross unrelated discs. They deserve a separate prototype if tiering proves insufficient.
- **Hierarchical edge bundling** (Holten, IEEE TVCG 2006; DOI recalled, unverified): route each edge as a spline through the centres of the regions on its tree path. It keeps per-edge identity and reuses the region geometry as control points. Cost is O(depth) control points per edge per frame, with endpoints moving while notes settle. Curves can share a canvas path as Bézier subpaths, so batching by style class does not require flattening to polylines; construction and rasterisation still cost work.

## Tests and acceptance

Few and sharp, per project convention:

1. **Classification is exhaustive and ordered:** same `dir` including root, `A` ↔ `A/B`, siblings under a top-level folder, root note ↔ folder, and two top-level folders.
2. **Culling keeps crossing segments:** a segment with both endpoints outside the viewport that crosses it is drawn; one that misses it is not, including a stroke-width margin case.
3. **Precedence:** Off draws nothing; otherwise a focused note's edges beat the tier and are painted last, in hover, cursor, selected order; local-graph mode draws every edge at full strength.
4. **Reciprocal dedupe:** a mutual pair is drawn once at rest and the model's edge count is unchanged.
5. **A browser-rendered comparison** of a small overlapping-edges scene, with and without batching, in both themes, because only an image shows the accumulation difference.

No performance or coverage thresholds are proposed. Judge paint cost by bench numbers before and after, on a dense case.

## Open questions

1. Focus-time direction colours (outgoing, incoming, mutual): ship with the first increment or defer.
2. Whether the dedupe should also apply to the model's link counts shown elsewhere (no: counts stay as they are).
3. Whether batching is adopted, once the before and after images have been compared.
4. The scope and timing of porting the tiers to the non-nested layouts.
