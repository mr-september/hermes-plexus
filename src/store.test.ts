import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeDisk } from '../test/fake-disk'
import { PrefsStore } from './prefs'
import { VaultStore } from './store'

const storage = () => {
  const data = new Map<string, unknown>()

  return {
    get: <T,>(key: string, fallback: T): T => (data.has(key) ? (data.get(key) as T) : fallback),
    remove: (key: string) => void data.delete(key),
    set: (key: string, value: unknown) => void data.set(key, value)
  }
}

const SEED = {
  'Alpha.md': 'alpha → [[Beta]] and [[Concepts/Gamma]] #idea',
  'Concepts/Beta.md': 'beta → [[Alpha]]',
  'Concepts/Gamma.md': 'gamma',
  'Daily/Day.md': 'see [[Beta|the beta]] and ![[Beta]]',
  'archive/Old.md': 'old [[Alpha]]'
}

let disk: FakeDisk
let prefs: PrefsStore
let store: VaultStore

const ready = async () => {
  store.start()
  await vi.waitFor(() => expect(store.get().status.loading).toBe(false))
  await vi.waitFor(() => expect(store.get().notes.length).toBeGreaterThan(0))
}

beforeEach(() => {
  disk = new FakeDisk('C:\\v', SEED)
  prefs = new PrefsStore(storage())
  prefs.useVault('C:\\v')
  store = new VaultStore(disk.bridge, prefs, (key, ...args) => `${key}:${args.join('|')}`)
})

afterEach(async () => {
  await store.dispose()
  vi.useRealTimers()
})

describe('scanning', () => {
  it('lists markdown notes, skips configured folders, and builds the link graph with tags', async () => {
    await ready()

    const { graph, notes } = store.get()

    expect(notes.map(n => n.rel)).toEqual(['Alpha.md', 'Concepts/Beta.md', 'Concepts/Gamma.md', 'Daily/Day.md'])
    expect(disk.readDirCalls.some(d => d.toLowerCase().includes('archive'))).toBe(false)
    // Alpha→Beta, Alpha→Gamma, Beta→Alpha, Day→Beta (its alias link and embed dedupe).
    expect(graph.edges).toHaveLength(4)
    expect(graph.nodes.find(n => n.id === 'Alpha.md')?.tags).toEqual(['idea'])
  })

  it('includes skipped folders when asked', async () => {
    prefs.set({ showHidden: true })
    await ready()

    expect(store.get().notes.some(n => n.rel === 'archive/Old.md')).toBe(true)
  })

  it('marks notes changed by something else as touched, but not our own saves', async () => {
    await ready()
    store.open('Concepts/Gamma.md')
    await vi.waitFor(() => expect(store.get().tabs[0]?.status).toBe('ready'))

    store.edit('Concepts/Gamma.md', 'gamma edited by me')
    await store.save('Concepts/Gamma.md')
    disk.files.set(disk.abs('Daily/Day.md'), 'rewritten elsewhere')
    await store.scan('full')

    expect(Object.keys(store.get().touched)).toEqual(['Daily/Day.md'])
  })

  it('a dirs-only rescan picks up new notes without re-reading unchanged ones', async () => {
    await ready()
    disk.files.set(disk.abs('Fresh.md'), 'new [[Alpha]]')

    const reads = vi.spyOn(disk.bridge, 'readFileText')

    await store.scan('dirs')

    expect(store.get().notes.some(n => n.rel === 'Fresh.md')).toBe(true)
    expect(reads.mock.calls.map(c => c[0])).toEqual([disk.abs('Fresh.md')])
  })
})

describe('editing', () => {
  it('autosaves after the idle delay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    prefs.set({ autosaveMs: 50 })
    await ready()
    store.open('Alpha.md')
    await vi.waitFor(() => expect(store.get().tabs[0]?.status).toBe('ready'))

    store.edit('Alpha.md', 'changed [[Gamma]]')
    expect(disk.writes).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(60)

    expect(disk.text('Alpha.md')).toBe('changed [[Gamma]]')
    // Our own save updates the graph immediately.
    expect(store.get().graph.edges.some(e => e.source === 'Alpha.md' && e.target === 'Concepts/Gamma.md')).toBe(true)
  })

  it('refuses to overwrite a note changed on disk until forced', async () => {
    await ready()
    store.open('Alpha.md')
    await vi.waitFor(() => expect(store.get().tabs[0]?.status).toBe('ready'))

    store.edit('Alpha.md', 'mine')
    disk.files.set(disk.abs('Alpha.md'), 'theirs')

    expect(await store.save('Alpha.md')).toBe(false)
    expect(store.get().tabs[0]?.status).toBe('conflict')
    expect(disk.text('Alpha.md')).toBe('theirs')
    expect(await store.save('Alpha.md', true)).toBe(true)
    expect(disk.text('Alpha.md')).toBe('mine')
  })

  it('reloads a clean open note when it changes on disk, but leaves a dirty one alone', async () => {
    await ready()
    store.open('Alpha.md')
    store.open('Concepts/Beta.md')
    await vi.waitFor(() => expect(store.get().tabs.every(t => t.status === 'ready')).toBe(true))

    store.edit('Concepts/Beta.md', 'dirty draft')
    disk.files.set(disk.abs('Alpha.md'), 'agent rewrote this')
    disk.files.set(disk.abs('Concepts/Beta.md'), 'agent rewrote this too')
    await store.scan('full')

    const tabs = Object.fromEntries(store.get().tabs.map(t => [t.rel, t]))

    expect(tabs['Alpha.md']?.draft).toBe('agent rewrote this')
    expect(tabs['Concepts/Beta.md']?.draft).toBe('dirty draft')
  })
})

describe('file operations', () => {
  it('renames a note and rewrites links that pointed at it, preserving aliases and embeds', async () => {
    await ready()

    expect((await store.rename('Concepts/Beta.md', 'Delta')).ok).toBe(true)

    expect(disk.text('Concepts/Delta.md')).toBe('beta → [[Alpha]]')
    expect(disk.text('Alpha.md')).toBe('alpha → [[Delta]] and [[Concepts/Gamma]] #idea')
    expect(disk.text('Daily/Day.md')).toBe('see [[Delta|the beta]] and ![[Delta]]')
    expect(store.get().notes.map(n => n.rel)).toContain('Concepts/Delta.md')
    expect(store.get().graph.edges.some(e => e.target === 'Concepts/Delta.md')).toBe(true)
    expect(store.get().notice?.text).toBe('warn.linksRewritten:3|2')
  })

  it('does not touch a note with unsaved edits and says so', async () => {
    await ready()
    store.open('Daily/Day.md')
    await vi.waitFor(() => expect(store.get().tabs[0]?.status).toBe('ready'))
    store.edit('Daily/Day.md', 'unsaved [[Beta]]')

    await store.rename('Concepts/Beta.md', 'Delta')

    expect(disk.text('Daily/Day.md')).toBe(SEED['Daily/Day.md'])
    expect(store.get().notice).toMatchObject({ kind: 'error' })
  })

  it('refuses a rename onto an existing note and bad names, but allows a case-only rename', async () => {
    await ready()

    expect((await store.rename('Concepts/Beta.md', 'Gamma')).ok).toBe(false)
    expect((await store.rename('Concepts/Beta.md', 'a/b')).ok).toBe(false)
    expect((await store.rename('Concepts/Beta.md', 'BETA')).ok).toBe(true)
  })

  it('moves a note between folders, rewriting only path-qualified links', async () => {
    await ready()

    expect((await store.move('Concepts/Gamma.md', 'Daily')).ok).toBe(true)

    expect(disk.text('Daily/Gamma.md')).toBe('gamma')
    expect(disk.text('Concepts/Gamma.md')).toBeUndefined()
    expect(disk.trashed).toEqual([disk.abs('Concepts/Gamma.md')])
    expect(disk.text('Alpha.md')).toBe('alpha → [[Beta]] and [[Daily/Gamma]] #idea')
  })

  it('refuses to move onto an existing note and leaves both files intact', async () => {
    await ready()
    disk.files.set(disk.abs('Daily/Gamma.md'), 'other gamma')

    expect((await store.move('Concepts/Gamma.md', 'Daily')).ok).toBe(false)
    expect(disk.text('Concepts/Gamma.md')).toBe('gamma')
    expect(disk.text('Daily/Gamma.md')).toBe('other gamma')
    expect(disk.trashed).toEqual([])
  })

  it('creates, opens and indexes a new note; refuses duplicates', async () => {
    await ready()

    expect((await store.create('Concepts', 'Epsilon')).ok).toBe(true)
    expect(disk.text('Concepts/Epsilon.md')).toBe('# Epsilon\n')
    expect(store.get().active).toBe('Concepts/Epsilon.md')
    expect((await store.create('Concepts', 'Epsilon')).ok).toBe(false)
  })

  it('deletes to the trash and drops the tab', async () => {
    await ready()
    store.open('Alpha.md')

    expect((await store.remove('Alpha.md')).ok).toBe(true)
    expect(disk.trashed).toEqual([disk.abs('Alpha.md')])
    expect(store.get().tabs).toHaveLength(0)
    expect(store.get().notes.some(n => n.rel === 'Alpha.md')).toBe(false)
  })

  it('follows a link to an existing note, and creates a missing one beside the source note', async () => {
    await ready()
    await store.follow('gamma', 'Alpha.md')
    expect(store.get().active).toBe('Concepts/Gamma.md')

    await store.follow('Brand New', 'Concepts/Beta.md')
    expect(disk.text('Concepts/Brand New.md')).toBe('# Brand New\n')
    expect(store.get().active).toBe('Concepts/Brand New.md')
  })
})

describe('persistence', () => {
  it('keeps positions of each layout apart: merges within a layout, replaces on a change, never mixes nested offsets in', async () => {
    await ready()
    store.setPositions('folder', { 'A.md': [1, 2] })
    store.setPositions('folder', { 'B.md': [3, 4] })
    expect(store.get().vault.positions).toEqual({ 'A.md': [1, 2], 'B.md': [3, 4] })
    store.setNestedPositions({ 'A.md': ['X', 0.1, 0.2] })
    expect(store.get().vault.positions).toHaveProperty('A.md')
    store.setPositions('none', { 'C.md': [5, 6] })
    expect(store.get().vault.positions).toEqual({ 'C.md': [5, 6] })
    expect(store.get().vault.positionsMode).toBe('none')
    expect(store.get().vault.nestedPositions).toEqual({ 'A.md': ['X', 0.1, 0.2] })
  })

  it('restores open tabs and the active note for the vault', async () => {
    await ready()
    store.open('Alpha.md')
    store.open('Concepts/Beta.md')
    await store.dispose()

    const again = new VaultStore(disk.bridge, prefs, key => key)

    again.start()
    await vi.waitFor(() => expect(again.get().tabs.map(t => t.rel)).toEqual(['Alpha.md', 'Concepts/Beta.md']))
    expect(again.get().active).toBe('Concepts/Beta.md')
    await again.dispose()
  })
})

describe('links with anchors, images and embeds', () => {
  it('opens the note and records a jump for a heading link', async () => {
    await ready()

    expect(await store.follow('Concepts/Beta#Section One', 'Alpha.md')).toBe(true)
    expect(store.get().active).toBe('Concepts/Beta.md')
    expect(store.get().jump).toMatchObject({ anchor: 'Section One', rel: 'Concepts/Beta.md' })

    store.clearJump()
    expect(store.get().jump).toBeNull()
  })

  it('never creates a note for a link that comes from chat', async () => {
    await ready()
    const before = disk.writes.length

    expect(await store.follow('Hallucinated Note', null, false)).toBe(false)
    expect(disk.writes).toHaveLength(before)
    expect(store.get().notice).toMatchObject({ kind: 'error', text: 'warn.notFound:Hallucinated Note' })
  })

  it('whenReady resolves after the first scan, and false when no vault is chosen', async () => {
    const empty = new VaultStore(disk.bridge, new PrefsStore(storage()), key => key)

    expect(await empty.whenReady()).toBe(false)

    store.start()
    expect(await store.whenReady()).toBe(true)
  })

  it('lists images, serves them as data URLs (cached), and reads embedded note text', async () => {
    disk.images.set(disk.abs('img/pic.png'), 'data:image/png;base64,AAAA')
    await ready()

    expect(store.get().assets.map(a => a.rel)).toEqual(['img/pic.png'])

    const read = vi.spyOn(disk.bridge, 'readFileDataUrl')

    expect(await store.imageUrl('img/pic.png')).toBe('data:image/png;base64,AAAA')
    expect(await store.imageUrl('img/pic.png')).toBe('data:image/png;base64,AAAA')
    expect(read).toHaveBeenCalledTimes(1)
    expect(await store.imageUrl('img/none.png')).toBeNull()

    expect(await store.noteText('Concepts/Gamma.md')).toBe('gamma')
    expect(await store.noteText('Nope.md')).toBeNull()
  })
})
