// Generates demo/vault/ — an entirely fictional research vault ("Tidal Garden", a made-up
// intertidal-ecology + sensor-network project) used for screenshots and for trying the plugin
// without pointing it at real notes. Every person, result and number below is invented.
//
//   node demo/make-vault.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), 'vault')
const notes = []

const note = (path, tags, body) => notes.push({ body: body.trim() + '\n', path, tags })

// ---- Concepts ------------------------------------------------------------------------------------

note('Concepts/Intertidal zone', ['ecology', 'concept'], `
# Intertidal zone

The strip of shore between high and low tide. Conditions swing from submerged to exposed to
sun-baked several times a day, which is why organisms sort themselves into bands — see [[Zonation]].

## Zones

- **Splash zone** — wetted only by spray; lichens and periwinkles.
- **High intertidal** — barnacles and limpets, exposed for hours.
- **Mid intertidal** — mussel beds, the home turf of the [[Keystone species|keystone predator]].
- **Low intertidal** — kelp, anemones, urchins; see [[Kelp forest]].

Pools left behind at low tide are their own small worlds: [[Tidal pool]].
`)

note('Concepts/Zonation', ['ecology', 'concept'], `
# Zonation

Vertical banding of species along a shore. Physical stress sets the upper limit of a band; competition
and predation set the lower limit.

![[Intertidal zone#Zones]]

Our [[E1 Transect survey]] measures it directly, and [[Sampling bias]] is the main way we could fool ourselves.
`)

note('Concepts/Keystone species', ['ecology', 'concept'], `
# Keystone species

A species whose effect on its community is far larger than its abundance suggests. The classic case is
a mid-shore predator that keeps the dominant mussel from monopolising space.

Removing it is the premise of [[H1 Predator removal]] and the cages in [[E2 Exclusion cages]].
It reshapes the whole [[Food web]] and, over time, drives [[Succession]].
`)

note('Concepts/Food web', ['ecology', 'concept', 'network'], `
# Food web

Who eats whom, drawn as a network. Hubs in the web tend to be the [[Keystone species|keystones]].
Feeding links are one kind of edge; [[Mutualism]] and [[Nutrient cycling]] add others.

The same maths as our sensor mesh: [[Graph theory]] applies to both.
`)

note('Concepts/Mutualism', ['ecology', 'concept'], `
# Mutualism

Both partners benefit. In the pools: anemones sheltering small fish that clean them, and algae living
inside corals and anemones. A mutualism is a positive edge in the [[Food web]].
`)

note('Concepts/Nutrient cycling', ['ecology', 'concept'], `
# Nutrient cycling

Nitrogen and phosphorus move between water, algae, grazers and sediment. Storm runoff delivers pulses —
the subject of [[H3 Nutrient pulses]], measured by [[E4 Water sampling]].
`)

note('Concepts/Succession', ['ecology', 'concept'], `
# Succession

How a cleared patch of rock re-fills: fast green algae, then barnacles, then mussels, if nothing interferes.
The [[Keystone species]] can hold a patch in an early stage indefinitely.
`)

note('Concepts/Kelp forest', ['ecology', 'concept'], `
# Kelp forest

Canopy algae in the low intertidal and subtidal. Provides habitat, buffers waves, and exports detritus
that feeds the whole shore ([[Nutrient cycling]]).
`)

note('Concepts/Tidal pool', ['ecology', 'concept'], `
# Tidal pool

A pocket of seawater stranded at low tide. Small volume means big swings: warm days push temperature and
salinity hard — the stress behind [[H2 Temperature stress]] and the loggers in [[E3 Thermal loggers]].
`)

note('Concepts/Sampling bias', ['method', 'concept'], `
# Sampling bias

Where you put your quadrats decides what you find. Walking to the "interesting" patch over-samples dense,
accessible shore. Defence: random transect starts ([[Quadrat sampling]]) and logging every discard.
`)

note('Concepts/Signal propagation', ['sensors', 'concept'], `
# Signal propagation

Radio in a rocky shore is awkward: wet rock absorbs, tide changes the geometry, and a node can be
underwater for hours. Design consequence for the [[Sensor Mesh]]: store-and-forward, never assume a live path.
`)

note('Concepts/Mesh networking', ['sensors', 'concept', 'network'], `
# Mesh networking

Nodes relay for each other, so one dead link does not strand a sensor. Routing is a [[Graph theory]]
problem; our constraints come from [[Signal propagation]] and battery.
`)

note('Concepts/Graph theory', ['math', 'concept', 'network'], `
# Graph theory

Nodes and edges. Useful twice over here: the [[Food web]] of the shore, and the radio topology of the
[[Mesh networking|mesh]]. Hubs, components, shortest paths, robustness to node loss.
`)

note('Concepts/Sensor drift', ['sensors', 'concept'], `
# Sensor drift

Readings creep away from truth as a sensor ages or fouls. Salt and algae are brutal. Handled by periodic
[[Calibration]] and by flagging any logger whose offset grows — see [[E3 Thermal loggers]].
`)

// ---- Projects ------------------------------------------------------------------------------------

note('Projects/Tidal Garden', ['project', 'hub'], `
---
status: active
---
# Tidal Garden

A two-year study of how one predator shapes a rocky shore, with a low-power sensor network watching
temperature and water chemistry.

## Workstreams

- Ecology: [[H1 Predator removal]], [[H2 Temperature stress]], [[H3 Nutrient pulses]]
- Sensing: [[Sensor Mesh]] and the [[Data Pipeline]]
- Fieldwork: [[Field Season 2026]]
- Communication: [[Public Dashboard]], [[Grant Report Q3]]

## People

[[Ines Okafor]] leads. [[Mateo Lindqvist]] runs the mesh, [[Priya Raman]] the stats,
[[Tomas Ebert]] the boat, [[Hana Sato]] the outreach, with help from the [[Lab technicians]].
`)

note('Projects/Sensor Mesh', ['project', 'sensors'], `
# Sensor Mesh

Twelve solar-powered nodes along three transects, each with a thermal logger and a conductivity probe.
Design notes: [[Mesh networking]], [[Signal propagation]], [[Sensor drift]].

Owner: [[Mateo Lindqvist]]. Feeds the [[Data Pipeline]]; hardware checked each trip in [[Field Season 2026]].
`)

note('Projects/Field Season 2026', ['project', 'fieldwork'], `
# Field Season 2026

Eight low-tide trips, September to November.

![[transect-map.svg|420]]

Transects A–C are surveyed in [[E1 Transect survey]]; the cages ([[E2 Exclusion cages]]) sit on B.
Tide tables, weather and crew on the [[2026-09-01]] and [[2026-09-04]] dailies.
`)

note('Projects/Data Pipeline', ['project', 'data'], `
# Data Pipeline

Raw logger files → cleaning → calibrated tables → the [[Public Dashboard]].
Cleaning rules come from [[Sensor drift]] and [[Calibration]]. Owner: [[Priya Raman]].
`)

note('Projects/Public Dashboard', ['project', 'outreach'], `
# Public Dashboard

A simple page showing current pool temperatures. Built from the [[Data Pipeline]]; copy by [[Hana Sato]].
`)

note('Projects/Grant Report Q3', ['project', 'admin'], `
# Grant Report Q3

Due end of October. Pulls results from [[H1 Predator removal]] and [[H2 Temperature stress]], and progress
from [[Field Season 2026]] and the [[Sensor Mesh]]. Drafted by [[Ines Okafor]].
`)

// ---- Research ------------------------------------------------------------------------------------

note('Research/H1 Predator removal', ['hypothesis'], `
# H1 — Predator removal

**Claim:** removing the mid-shore predator lets mussels take over space and cuts species richness.

Tested by [[E2 Exclusion cages]]. Background: [[Keystone species]], [[Succession]]. Part of [[Tidal Garden]].
`)

note('Research/H2 Temperature stress', ['hypothesis'], `
# H2 — Temperature stress

**Claim:** heat spikes in small pools set the upper limit of the grazers' band.

Evidence from [[E3 Thermal loggers]]; context in [[Tidal pool]] and [[Zonation]].
`)

note('Research/H3 Nutrient pulses', ['hypothesis'], `
# H3 — Nutrient pulses

**Claim:** short runoff pulses after storms drive algal blooms more than the seasonal baseline.

Measured via [[E4 Water sampling]]; mechanism in [[Nutrient cycling]].
`)

note('Research/E1 Transect survey', ['experiment'], `
# E1 — Transect survey

Three 20 m transects, quadrats every 2 m, counted at each low tide. Method: [[Quadrat sampling]].
Results feed [[Zonation]]; watch for [[Sampling bias]]. Run in [[Field Season 2026]].
`)

note('Research/E2 Exclusion cages', ['experiment'], `
# E2 — Exclusion cages

Six cage plots (predator excluded) and six open controls on transect B. Tests [[H1 Predator removal]].
Checked every trip by [[Tomas Ebert]] and the [[Lab technicians]].
`)

note('Research/E3 Thermal loggers', ['experiment', 'sensors'], `
# E3 — Thermal loggers

One logger per pool, hourly readings. Tests [[H2 Temperature stress]]. Data cleaned in the [[Data Pipeline]];
offsets tracked against [[Sensor drift]] and fixed by [[Calibration]].
`)

note('Research/E4 Water sampling', ['experiment'], `
# E4 — Water sampling

Bottle samples before and after storms, analysed for nitrogen and phosphorus. Tests [[H3 Nutrient pulses]].
Sampling days in the [[2026-09-08]] and [[2026-09-12]] dailies.
`)

note('Research/Quadrat sampling', ['method'], `
# Quadrat sampling

A 0.25 m² frame, placed at random starts along a transect, every organism counted. The antidote to
[[Sampling bias]]. Used by [[E1 Transect survey]].
`)

note('Research/Calibration', ['method', 'sensors'], `
# Calibration

Every logger is checked in a stirred ice bath and a warm bath before and after deployment. The difference
is the drift correction applied in the [[Data Pipeline]]. See [[Sensor drift]].
`)

// ---- People --------------------------------------------------------------------------------------

note('People/Ines Okafor', ['person'], `
# Ines Okafor

Principal investigator. Leads [[Tidal Garden]]; writes the [[Grant Report Q3]]; owns [[H1 Predator removal]].
`)

note('People/Mateo Lindqvist', ['person'], `
# Mateo Lindqvist

Engineer. Builds and maintains the [[Sensor Mesh]]; thinks hardest about [[Mesh networking]].
`)

note('People/Priya Raman', ['person'], `
# Priya Raman

Statistician. Owns the [[Data Pipeline]] and the analysis of [[E1 Transect survey]] and [[E3 Thermal loggers]].
`)

note('People/Tomas Ebert', ['person'], `
# Tomas Ebert

Boat captain and field lead for [[Field Season 2026]]; tends the cages in [[E2 Exclusion cages]].
`)

note('People/Hana Sato', ['person'], `
# Hana Sato

Outreach. Writes the copy for the [[Public Dashboard]].
`)

note('People/Lab technicians', ['person', 'group'], `
# Lab technicians

Rotating crew of four. Help with [[Quadrat sampling]], [[Calibration]] and the cage checks in [[E2 Exclusion cages]].
`)

// ---- Daily ---------------------------------------------------------------------------------------

note('Daily/2026-09-01', ['daily'], `
# 2026-09-01

First trip of [[Field Season 2026]]. Low tide 06:12. Marked transect starts for [[E1 Transect survey]]
using random offsets ([[Quadrat sampling]]). [[Tomas Ebert]] ran the boat. Two nodes of the [[Sensor Mesh]]
fouled already — note for [[Mateo Lindqvist]].
`)

note('Daily/2026-09-04', ['daily'], `
# 2026-09-04

Second trip. Installed cages for [[E2 Exclusion cages]]; swell made it slow. Crew: [[Lab technicians]].
Loggers swapped on transect A ([[E3 Thermal loggers]]).
`)

note('Daily/2026-09-08', ['daily'], `
# 2026-09-08

Storm overnight. Took the first post-storm bottles for [[E4 Water sampling]]. Mesh lost two links but
store-and-forward kept the data ([[Signal propagation]]).
`)

note('Daily/2026-09-12', ['daily'], `
# 2026-09-12

Second round of [[E4 Water sampling]]. Chat with [[Priya Raman]] about how to weight the storm days in
the analysis for [[H3 Nutrient pulses]].
`)

note('Daily/2026-09-15', ['daily'], `
# 2026-09-15

Calibration day in the lab ([[Calibration]]). Three loggers show growing offsets — logged under
[[Sensor drift]]. Draft figures for the [[Grant Report Q3]].
`)

note('Daily/2026-09-19', ['daily'], `
# 2026-09-19

Warm spell. Pool temperatures peaked early afternoon; good data for [[H2 Temperature stress]].
Dashboard copy review with [[Hana Sato]] ([[Public Dashboard]]).
`)

// ---- References ----------------------------------------------------------------------------------

note('References/Reading - Zonation patterns', ['reading'], `
# Reading — Zonation patterns

(Fictional reading note.) Summary of how physical and biological limits combine to set band edges.
Supports [[Zonation]] and the design of [[E1 Transect survey]].
`)

note('References/Reading - Keystone effects', ['reading'], `
# Reading — Keystone effects

(Fictional reading note.) Argues that removal experiments are the cleanest test. Motivates [[H1 Predator removal]].
`)

note('References/Reading - Low-power radio', ['reading'], `
# Reading — Low-power radio

(Fictional reading note.) Duty-cycling and store-and-forward for harsh sites. Informs the [[Sensor Mesh]].
`)

note('References/Reading - Runoff and blooms', ['reading'], `
# Reading — Runoff and blooms

(Fictional reading note.) Pulse timing versus bloom response. Background for [[H3 Nutrient pulses]].
`)

note('References/Reading - Logger fouling', ['reading'], `
# Reading — Logger fouling

(Fictional reading note.) Biofouling shifts readings within weeks in warm water. See [[Sensor drift]].
`)

// ---- Archive (hidden by default) -----------------------------------------------------------------

note('archive/Old sampling plan', ['archive'], `
# Old sampling plan

Superseded by [[Quadrat sampling]]. Kept for the record.
`)

note('archive/Superseded sensor spec', ['archive'], `
# Superseded sensor spec

Replaced by the [[Sensor Mesh]] design.
`)

note('archive/Draft grant outline', ['archive'], `
# Draft grant outline

Early outline, now the [[Grant Report Q3]].
`)

// ---- write ---------------------------------------------------------------------------------------

rmSync(out, { force: true, recursive: true })

for (const { body, path, tags } of notes) {
  const file = join(out, `${path}.md`)
  const hasFrontmatter = body.startsWith('---')
  const tagLine = `tags: [${tags.join(', ')}]`

  const text = hasFrontmatter
    ? body.replace(/^---\n/, `---\n${tagLine}\n`)
    : `---\n${tagLine}\n---\n${body}`

  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

// A small map used by the image embed.
const zones = [
  ['Splash', '#d9c7a1'],
  ['High', '#bfa987'],
  ['Mid', '#7aa6a0'],
  ['Low', '#3f7f93']
]

const bars = zones
  .map(([name, colour], i) => {
    const y = 20 + i * 52

    return `<rect x="20" y="${y}" width="380" height="44" rx="6" fill="${colour}"/><text x="34" y="${y + 28}" font-family="sans-serif" font-size="16" fill="#102027">${name} intertidal</text>`
  })
  .join('')

const transects = ['A', 'B', 'C']
  .map((t, i) => `<line x1="${110 + i * 90}" y1="14" x2="${110 + i * 90}" y2="236" stroke="#102027" stroke-width="2" stroke-dasharray="5 4"/><text x="${104 + i * 90}" y="250" font-family="sans-serif" font-size="14" fill="#102027">${t}</text>`)
  .join('')

mkdirSync(join(out, 'Attachments'), { recursive: true })
writeFileSync(
  join(out, 'Attachments', 'transect-map.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="262" viewBox="0 0 420 262">${bars}${transects}</svg>\n`
)

console.log(`Wrote ${notes.length} notes + 1 image to ${out}`)
