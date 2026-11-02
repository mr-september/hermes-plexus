# Edge treatment in the nested graph

Status: proposal, nothing implemented. Written after the nested regions shipped (see [nested-folder-regions.md](nested-folder-regions.md)), when the live vault showed that edges, not regions or notes, now dominate the picture.

## Context and motivation

Today every edge is one straight line, 1 screen pixel wide, alpha 0.35, one muted colour, painted over the region discs and under the notes (`draw` in `src/graph-view.tsx`; on hover the focused note's edges go to alpha 0.9 in the accent colour and the rest to 0.08). That treatment was designed for the flat layouts, where distance already encodes locality. In nested mode it has three problems, all visible in the live screenshot:

1. **Cross-region edges form a haze over the map.** In nested mode a note's edge to another top-level folder crosses at least two region boundaries and the empty space between discs. These edges are the long ones, they are the majority in a densely cross-linked vault, and they paint over the discs that are supposed to carry the structure. Intra-folder edges, which are what explain a compartment's internal arrangement, are short and drowned out by them.
2. **The layout no longer needs cross-folder edges to be strong.** Cross-folder link strength was cut to 0.03 so they stop dragging notes to the rim. Those edges are now almost purely visual: they say "A and B are related" without influencing position. A purely visual channel can be encoded more compactly than one line per link.
3. **Cost is per edge, per frame.** The paint loop does `beginPath`/`stroke` for every edge on every tick and every pan/zoom frame. Cost is unmeasured in the Hermes webview; the earlier paint bench (headless Edge) is the place to measure it before and after.

## Edge classes

The folder tree gives a natural classification with no new data: the lowest common ancestor (LCA) of the two notes' folders.

| class | LCA | meaning |
|---|---|---|
| intra-compartment | the notes' own folder | same folder; the local texture of a compartment |
| intra-top | a folder below the root, above both notes' folders | same top-level folder, different subfolders |
| inter-top | the vault root | crosses top-level containers |

Depth of the LCA is a finer scalar (`span`, the number of region boundaries the straight line crosses is a related quantity) and is what the proposals below actually key on; the three classes are its coarse reading. Computing it is O(depth) per edge, once per graph change, from `geometry.byDir` and the region parent chain.

## Proposals

They are ordered by dependency and by cost; each can be adopted without the next.

### E0. Batch strokes and cull to the viewport (no visual change)

Group edges by style class and issue one path and one `stroke` per class instead of one per edge; skip an edge whose bounding box misses the viewport. Zoomed in, most edges are off screen, so the cull is the larger saving there; batching helps at every zoom. This changes nothing a user sees, only cost, and every later proposal assumes it (a handful of classes is cheap to batch; per-edge styles are not). Measure with the paint bench before deciding the rest is needed for performance reasons, as opposed to legibility reasons.

### E1. Tier the style by class

Intra-compartment edges keep the current weight, tinted with the folder's hue so they read as part of the region. Intra-top edges are lighter, same hue. Inter-top edges are the faintest, neutral (or a two-stop gradient between the endpoint hues, which costs a gradient object per edge and so conflicts with E0; a neutral colour batches). Hover and selection override the tier: a focused note's edges are fully drawn regardless of class, so the haze is a resting state, not a loss of information.

Rationale: it applies the visual hierarchy the regions already establish. The reader should see structure first (discs), local relations second (intra edges), global relations third (cross edges).

Open: whether inter-top edges should be neutral or hued. Neutral is cheaper and quieter; hued by the source's top-level folder makes direction-free edges look directional.

### E2. Gate edges by zoom, using the same bands as regions and labels

The map already has semantic zoom bands for regions (`REGION_MIN_PX`) and labels (`LABEL_MIN_PX`). Edges can follow the same rule keyed on the LCA region's on-screen radius `s`:

- an edge of LCA region R is drawn at full tier strength only while R's on-screen radius is below the viewport-covering scale and above a minimum (below it, the region is a dot and its internal edges are sub-pixel);
- once R has outgrown the viewport (the existing `covers` condition) its internal edges stay, and edges of enclosing LCAs are faded further, because their far endpoints are off screen anyway;
- inter-top edges fade out as the camera enters a single top-level region, and return when it backs out.

The effect is that the edges drawn at any zoom are those that connect things visible at that zoom, which is the same promise the labels make. This needs per-edge LCA depth (above) and nothing else; it is a change of alpha, not of geometry.

### E3. Bundle inter-top edges

For graphs where E1 and E2 still leave a hairball, replace individual inter-top edges at low zoom by one aggregate per pair of sibling regions at the LCA: a ribbon between the two child regions, width growing with the log of the edge count, expanding into the individual edges when the camera zooms into either endpoint region or the user hovers a note. At most min(E, R²) ribbons for R sibling regions at that level, usually far fewer than E.

Two forms, in increasing cost:

- **Ribbons between region discs**: straight or gently curved bands between disc boundaries. Static geometry (regions do not move), so the ribbon set changes only when the graph does. Cheap to draw; loses which notes are linked until expanded.
- **Hierarchical edge bundling** (Holten, IEEE TVCG 2006; DOI recalled, unverified): route each edge as a B-spline through the centres of the regions on the tree path between its endpoints, with a tension parameter. Keeps per-edge identity, exposes the hierarchy, and reuses the region geometry as control points. Cost is O(depth) control points per edge per frame, and endpoints move while notes settle, so curves are rebuilt on tick. It also does not compose with E0's one-path-per-class batching unless curves are flattened into polylines first.

I would start with ribbons. The nested map already has the hierarchy as geometry, so the bundling control points are free, but the per-frame cost and the loss of straight-line readability for the bundled curves are the sort of thing to measure on the real vault first, not to assume.

### E4. A user-visible control

A three-state `Edges` control in the toolbar beside the layout and labels toggles, in the same spirit: `All` (every edge at its tier), `Tiered` (the default: E1 and E2), `Off`. `Off` matters for very large vaults and for reading structure alone. Per-class toggles are not proposed; the tiers are meant to make them unnecessary.

## Recommendation

Do E0 and E1 together: E0 is invisible and E1 is the largest legibility change per line of code. Then E2, which is cheap once the LCA depth exists. Hold E3 until the result of E0–E2 on the live vault is seen; if the inter-top layer still obscures the discs, use ribbons first. E4 can ship with E1 since it is a pref and a toolbar button.

## Tests and acceptance

Few and sharp, per project convention: (1) LCA classification on a small tree, including notes at the root and chained single-child folders (the same chain-collapse the regions use); (2) batching issues one stroke per class (assert on the recorded canvas calls) and the cull drops an off-screen edge; (3) hover restores full strength for the focused note's edges whatever their class. No performance or coverage thresholds are proposed; judge paint cost by the bench numbers before and after.

## Open questions

1. Inter-top edge colour: neutral or hued.
2. Whether an edge between a note and a hidden-folder region should be drawn at all (currently hidden notes and their edges are filtered out; unchanged unless decided otherwise).
3. Whether a note-to-note edge inside the same compartment ever needs bundling (no: it is short by construction).
4. Whether local-graph mode, which restricts to a neighbourhood, should bypass the tiers (likely yes: few edges, all relevant).
