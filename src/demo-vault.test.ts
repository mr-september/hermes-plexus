import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { assetResolver, buildGraph, extractWikilinks, indexNote, linkResolver, parseLinkTarget } from './model'

const ROOT = 'demo/vault'

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
}

const files = walk(ROOT).map(file => file.slice(ROOT.length + 1).split('\\').join('/'))
const notes = files.filter(file => file.endsWith('.md'))
const assets = files.filter(file => !file.endsWith('.md'))
const text = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('demo vault', () => {
  it('has every wikilink and embed resolve to a note or an image', () => {
    const resolveNote = linkResolver(notes)
    const resolveAsset = assetResolver(assets)
    const unresolved: string[] = []

    for (const rel of notes) {
      for (const link of extractWikilinks(text(rel))) {
        const { note } = parseLinkTarget(link)

        if (!resolveNote(note) && !resolveAsset(note, rel)) {
          unresolved.push(`${rel} -> ${link}`)
        }
      }
    }

    expect(unresolved).toEqual([])
  })

  it('is a connected, clustered graph with a clear hub and no orphans outside the archive', () => {
    const graph = buildGraph(notes.map(rel => indexNote(rel, text(rel))))
    const byId = Object.fromEntries(graph.nodes.map(node => [node.id, node]))
    const hub = [...graph.nodes].sort((a, b) => b.degree - a.degree)[0]!

    expect(graph.nodes.length).toBeGreaterThanOrEqual(45)
    expect(graph.edges.length).toBeGreaterThanOrEqual(120)
    expect(hub.id).toBe('Projects/Tidal Garden.md')
    expect(graph.nodes.filter(node => node.degree === 0).map(node => node.id)).toEqual([])
    expect(new Set(graph.nodes.map(node => node.folder)).size).toBe(7)
    expect(byId['archive/Old sampling plan.md']!.degree).toBeGreaterThan(0)
  })
})
