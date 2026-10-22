/**
 * The vault store: scanning and index cache, the graph, open note tabs (load / autosave /
 * conflict handling) and file operations that keep links consistent. Framework-free —
 * React reads it through `useSyncExternalStore` (see `useVault`) — so the logic is testable
 * against a fake disk.
 */

import type { Bridge } from './bridge'
import {
  backlinksOf,
  buildGraph,
  EMPTY_GRAPH,
  indexNote,
  isValidNoteName,
  linkResolver,
  noteTitle,
  type NoteIndex,
  parentDir,
  parseLinkTarget,
  retargetLinks,
  rewriteWikilinks,
  type VaultGraph,
  type VaultNote
} from './model'
import { EMPTY_VAULT_STATE, type PrefsStore, type VaultState } from './prefs'
import {
  BAD_NAME,
  createNote,
  dirPath,
  moveNote,
  readDataUrl,
  readNote,
  renameNote,
  type Result,
  scanVault,
  trashNote,
  writeNote
} from './vault-fs'

const READ_CONCURRENCY = 16
const PERSIST_MS = 400

export type NoteStatus = 'conflict' | 'error' | 'loading' | 'ready'

export interface OpenNote {
  /** The text last read from / written to disk — the baseline for conflict checks. */
  base: string
  draft: string
  editable: boolean
  error?: string
  /** Remounts the editor when the buffer is replaced from outside. */
  generation: number
  path: string
  rel: string
  saving: boolean
  status: NoteStatus
}

export interface Notice {
  kind: 'error' | 'info'
  text: string
}

export interface StoreState {
  active: null | string
  /** Image files in the vault, for previews. */
  assets: VaultNote[]
  graph: VaultGraph
  /** A pending "scroll to heading / block" for the note just opened from a `Note#anchor` link. */
  jump: null | { anchor: string; nonce: number; rel: string }
  notes: VaultNote[]
  notice: null | Notice
  root: string
  status: { error?: string; loading: boolean }
  tabs: OpenNote[]
  /** Notes changed on disk by something other than this plugin → when we noticed. */
  touched: Record<string, number>
  vault: VaultState
}

export type Translate = (key: string, ...args: unknown[]) => string

const hashText = (text: string): string => {
  let hash = 2166136261

  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  }

  return `${text.length}:${hash >>> 0}`
}

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        await fn(items[next++]!)
      }
    })
  )
}

const sameIndex = (a: NoteIndex, b: NoteIndex): boolean =>
  a.links.join('\0') === b.links.join('\0') && a.tags.join('\0') === b.tags.join('\0')

const withMd = (name: string): string => `${name.trim().replace(/\.md$/i, '')}.md`

export class VaultStore {
  private state: StoreState = {
    active: null,
    assets: [],
    graph: EMPTY_GRAPH,
    jump: null,
    notes: [],
    notice: null,
    root: '',
    status: { loading: false },
    tabs: [],
    touched: {},
    vault: EMPTY_VAULT_STATE
  }

  private listeners = new Set<() => void>()
  private cache = new Map<string, { hash: string; index: NoteIndex }>()
  private ownWrites = new Map<string, string>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private scanToken = 0
  private persistTimer: ReturnType<typeof setTimeout> | undefined
  private loadedKey = ''
  private unsubscribe: (() => void) | undefined
  private scanned = false
  private waiting: ((ready: boolean) => void)[] = []
  private imageCache = new Map<string, string>()

  constructor(
    private fs: Bridge,
    private prefs: PrefsStore,
    private t: Translate,
    private now: () => number = Date.now
  ) {}

  // ---- subscription ----------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)

    return () => void this.listeners.delete(listener)
  }

  get = (): StoreState => this.state

  private patch(change: Partial<StoreState>): void {
    this.state = { ...this.state, ...change }
    this.listeners.forEach(listener => listener())
  }

  private patchTab(rel: string, change: Partial<OpenNote>): void {
    this.patch({ tabs: this.state.tabs.map(tab => (tab.rel === rel ? { ...tab, ...change } : tab)) })
  }

  notify(kind: Notice['kind'], text: string): void {
    this.patch({ notice: { kind, text } })
  }

  dismissNotice(): void {
    this.patch({ notice: null })
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  /** Begin following the prefs (vault folder, hidden folders) and load the current vault. */
  start(): void {
    this.unsubscribe = this.prefs.subscribe(() => void this.syncPrefs())
    void this.syncPrefs()
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.()
    clearTimeout(this.persistTimer)
    this.persistNow()
    await this.flushAll()
  }

  private async syncPrefs(): Promise<void> {
    const { hiddenFolders, showHidden, vaultRoot } = this.prefs.get()
    const key = `${vaultRoot}|${showHidden ? '' : hiddenFolders.join(',')}`

    if (key === this.loadedKey) {
      return
    }

    const rootChanged = vaultRoot !== this.state.root

    this.loadedKey = key

    if (rootChanged) {
      await this.flushAll()
      this.cache.clear()
      this.ownWrites.clear()
      this.imageCache.clear()
      this.scanned = false
      this.patch({
        active: null,
        assets: [],
        graph: EMPTY_GRAPH,
        jump: null,
        notes: [],
        root: vaultRoot,
        tabs: [],
        touched: {},
        vault: vaultRoot ? this.prefs.loadVault(vaultRoot) : EMPTY_VAULT_STATE
      })
    }

    if (!vaultRoot) {
      this.settle(false)

      return
    }

    await this.scan('full')

    if (rootChanged) {
      this.restoreTabs()
    }
  }

  private settle(ready: boolean): void {
    this.scanned = ready || this.scanned
    this.waiting.splice(0).forEach(resolve => resolve(ready))
  }

  /** Resolves once the vault has been scanned (true), or straight away with false when no vault is chosen. */
  whenReady(): Promise<boolean> {
    if (this.scanned) {
      return Promise.resolve(true)
    }

    if (!this.prefs.get().vaultRoot) {
      return Promise.resolve(false)
    }

    return new Promise(resolve => this.waiting.push(resolve))
  }

  private restoreTabs(): void {
    const { active, tabs } = this.state.vault
    const known = new Map(this.state.notes.map(note => [note.rel, note]))

    for (const rel of tabs) {
      const note = known.get(rel)

      if (note) {
        this.openTab(note)
      }
    }

    this.patch({ active: active && known.has(active) ? active : (this.state.tabs[0]?.rel ?? null) })
  }

  // ---- scanning --------------------------------------------------------------------------------

  /** `full` re-reads every note; `dirs` only lists folders and reads new or open notes. */
  async scan(mode: 'dirs' | 'full' = 'full'): Promise<void> {
    const { hiddenFolders, showHidden, vaultRoot: root } = this.prefs.get()

    if (!root) {
      return
    }

    const token = ++this.scanToken

    this.patch({ status: { loading: true } })

    const found = await scanVault(this.fs, root, showHidden ? [] : hiddenFolders)

    if (token !== this.scanToken) {
      return
    }

    if (!found.ok) {
      this.patch({ status: { error: found.error, loading: false } })
      this.settle(false)

      return
    }

    const live = new Set(found.notes.map(note => note.rel))

    for (const rel of [...this.cache.keys()]) {
      if (!live.has(rel)) {
        this.cache.delete(rel)
      }
    }

    const open = new Set(this.state.tabs.map(tab => tab.rel))
    const touched = { ...this.state.touched }
    const disk = new Map<string, string>()

    const toRead = found.notes.filter(note => mode === 'full' || !this.cache.has(note.rel) || open.has(note.rel))

    await mapLimit(toRead, READ_CONCURRENCY, async note => {
      const res = await readNote(this.fs, note.path)

      if (!res.ok) {
        return
      }

      const hash = hashText(res.text)
      const previous = this.cache.get(note.rel)

      if (previous && previous.hash !== hash && this.ownWrites.get(note.rel) !== hash) {
        touched[note.rel] = this.now()
      }

      this.cache.set(note.rel, { hash, index: indexNote(note.rel, res.text) })

      if (open.has(note.rel)) {
        disk.set(note.rel, res.text)
      }
    })

    if (token !== this.scanToken) {
      return
    }

    this.patch({
      assets: found.assets,
      graph: this.graphFor(found.notes),
      notes: found.notes,
      status: { loading: false },
      touched
    })
    this.settle(true)

    for (const [rel, text] of disk) {
      this.applyDisk(rel, text)
    }
  }

  private graphFor(notes: readonly VaultNote[]): VaultGraph {
    return buildGraph(notes.map(note => this.cache.get(note.rel)?.index ?? { links: [], rel: note.rel, tags: [] }))
  }

  private reindex(rel: string, text: string): void {
    const index = indexNote(rel, text)
    const previous = this.cache.get(rel)

    this.cache.set(rel, { hash: hashText(text), index })

    if (!previous || !sameIndex(previous.index, index)) {
      this.patch({ graph: this.graphFor(this.state.notes) })
    }
  }

  /** A clean open tab adopts what is on disk; a dirty one waits for the conflict check. */
  private applyDisk(rel: string, text: string): void {
    const tab = this.state.tabs.find(item => item.rel === rel)

    if (tab && tab.status === 'ready' && tab.draft === tab.base && text !== tab.base) {
      this.patchTab(rel, { base: text, draft: text, generation: this.now() })
    }
  }

  // ---- note tabs -------------------------------------------------------------------------------

  private openTab(note: VaultNote): void {
    this.patch({
      tabs: [
        ...this.state.tabs,
        {
          base: '',
          draft: '',
          editable: false,
          generation: 0,
          path: note.path,
          rel: note.rel,
          saving: false,
          status: 'loading'
        }
      ]
    })
    void this.load(note.rel, note.path)
  }

  private async load(rel: string, path: string): Promise<void> {
    const res = await readNote(this.fs, path)

    if (!res.ok) {
      this.patchTab(rel, { error: res.error, status: 'error' })

      return
    }

    this.patchTab(rel, {
      base: res.text,
      draft: res.text,
      editable: res.editable,
      error: undefined,
      generation: this.now(),
      status: 'ready'
    })
  }

  open(rel: string, anchor?: null | string): void {
    const note = this.state.notes.find(item => item.rel === rel)

    if (!note) {
      return
    }

    this.activate(rel)

    if (!this.state.tabs.some(tab => tab.rel === rel)) {
      this.openTab(note)
    }

    if (anchor) {
      this.patch({ jump: { anchor, nonce: this.now(), rel } })
    }

    this.persist()
  }

  clearJump(): void {
    if (this.state.jump) {
      this.patch({ jump: null })
    }
  }

  /** The text of a note for embedding: the open draft if there is one, else the file on disk. */
  async noteText(rel: string): Promise<null | string> {
    const tab = this.state.tabs.find(item => item.rel === rel)

    if (tab && tab.status === 'ready') {
      return tab.draft
    }

    const note = this.state.notes.find(item => item.rel === rel)
    const res = note ? await readNote(this.fs, note.path) : null

    return res?.ok ? res.text : null
  }

  /** A vault image as a data URL (cached; the cache is small and per vault). */
  async imageUrl(rel: string): Promise<null | string> {
    const cached = this.imageCache.get(rel)

    if (cached) {
      return cached
    }

    const asset = this.state.assets.find(item => item.rel === rel)
    const res = asset ? await readDataUrl(this.fs, asset.path) : null

    if (!res?.ok) {
      return null
    }

    if (this.imageCache.size >= 40) {
      this.imageCache.delete(this.imageCache.keys().next().value!)
    }

    this.imageCache.set(rel, res.url)

    return res.url
  }

  activate(rel: null | string): void {
    const previous = this.state.active

    this.patch({ active: rel })

    if (previous && previous !== rel) {
      void this.save(previous)
    }

    this.persist()
  }

  edit(rel: string, draft: string): void {
    this.patchTab(rel, { draft })
    clearTimeout(this.timers.get(rel))
    this.timers.set(
      rel,
      setTimeout(() => void this.save(rel), this.prefs.get().autosaveMs)
    )
  }

  /** Write the draft; `force` skips the changed-on-disk check ("Overwrite"). */
  async save(rel: string, force = false): Promise<boolean> {
    clearTimeout(this.timers.get(rel))

    const tab = this.state.tabs.find(item => item.rel === rel)

    if (!tab || tab.status === 'loading' || !tab.editable || tab.draft === tab.base) {
      return true
    }

    this.patchTab(rel, { saving: true })

    const draft = tab.draft
    const res = await writeNote(this.fs, tab.path, draft, force ? null : tab.base)

    if (res.ok) {
      // Typing that landed during the write stays unsaved: only `base` moves.
      this.ownWrites.set(rel, hashText(draft))
      this.patchTab(rel, { base: draft, error: undefined, saving: false, status: 'ready' })
      this.reindex(rel, draft)

      return true
    }

    this.patchTab(rel, {
      error: res.error,
      saving: false,
      status: 'conflict' in res && res.conflict ? 'conflict' : 'error'
    })

    return false
  }

  async flushAll(): Promise<void> {
    await Promise.all(this.state.tabs.map(tab => this.save(tab.rel)))
  }

  async close(rel: string): Promise<void> {
    // A failed or conflicting save keeps the tab open so nothing is lost silently.
    if (!(await this.save(rel))) {
      this.patch({ active: rel })

      return
    }

    const list = this.state.tabs
    const index = list.findIndex(tab => tab.rel === rel)
    const rest = list.filter(tab => tab.rel !== rel)

    this.patch({
      active: this.state.active === rel ? (rest[Math.min(index, rest.length - 1)]?.rel ?? null) : this.state.active,
      tabs: rest
    })
    this.persist()
  }

  /** Replace the buffer with what is on disk (discarding the draft). */
  reload(rel: string): void {
    const tab = this.state.tabs.find(item => item.rel === rel)

    if (tab) {
      clearTimeout(this.timers.get(rel))
      void this.load(rel, tab.path)
    }
  }

  // ---- file operations -------------------------------------------------------------------------

  private addNote(note: VaultNote, text: string): void {
    this.cache.set(note.rel, { hash: hashText(text), index: indexNote(note.rel, text) })
    this.ownWrites.set(note.rel, hashText(text))

    const notes = [...this.state.notes.filter(item => item.rel !== note.rel), note].sort((a, b) =>
      a.rel.localeCompare(b.rel)
    )

    this.patch({ graph: this.graphFor(notes), notes })
  }

  private dropNote(rel: string): void {
    this.cache.delete(rel)
    this.ownWrites.delete(rel)

    const notes = this.state.notes.filter(item => item.rel !== rel)

    this.patch({ graph: this.graphFor(notes), notes })
  }

  private retab(rel: string, next: null | VaultNote): void {
    clearTimeout(this.timers.get(rel))

    const tabs = next
      ? this.state.tabs.map(tab => (tab.rel === rel ? { ...tab, path: next.path, rel: next.rel } : tab))
      : this.state.tabs.filter(tab => tab.rel !== rel)

    this.patch({ active: this.state.active === rel ? (next?.rel ?? null) : this.state.active, tabs })
  }

  /** Create a note and open it. */
  async create(dirRel: string, name: string, body?: string): Promise<Result> {
    const res = await createNote(this.fs, dirPath(this.state.root, dirRel), name, body)

    if (!res.ok) {
      return res
    }

    const rel = `${dirRel ? `${dirRel}/` : ''}${withMd(name)}`
    const text = body ?? `# ${noteTitle(rel)}\n`

    this.addNote({ path: res.path, rel }, text)
    this.open(rel)

    return { ok: true }
  }

  /** Rewrite links in the notes that point at `oldRel` after it moved to `newRel`. */
  private async rewriteBacklinks(
    oldRel: string,
    newRel: string,
    resolveBefore: (target: string) => string | undefined,
    sources: readonly string[]
  ): Promise<void> {
    const map = retargetLinks(oldRel, newRel, resolveBefore)
    const skipped: string[] = []
    let total = 0
    let touchedNotes = 0

    for (const rel of sources) {
      const note = this.state.notes.find(item => item.rel === rel)
      const tab = this.state.tabs.find(item => item.rel === rel)

      if (!note) {
        continue
      }

      if (tab && tab.draft !== tab.base) {
        skipped.push(noteTitle(rel))

        continue
      }

      const current = await readNote(this.fs, note.path)

      if (!current.ok || !current.editable) {
        skipped.push(noteTitle(rel))

        continue
      }

      const { count, text } = rewriteWikilinks(current.text, map)

      if (!count) {
        continue
      }

      const written = await writeNote(this.fs, note.path, text, current.text)

      if (!written.ok) {
        skipped.push(noteTitle(rel))

        continue
      }

      total += count
      touchedNotes++
      this.ownWrites.set(rel, hashText(text))
      this.reindex(rel, text)
      this.applyDisk(rel, text)
    }

    if (skipped.length) {
      this.notify('error', this.t('warn.linksSkipped', skipped.join(', ')))
    } else if (total) {
      this.notify('info', this.t('warn.linksRewritten', total, touchedNotes))
    }
  }

  /** Rename a note (in place) and update every link that pointed at it. */
  async rename(rel: string, name: string): Promise<Result> {
    const note = this.state.notes.find(item => item.rel === rel)

    if (!note) {
      return { error: 'Note not found', ok: false }
    }

    if (!isValidNoteName(name)) {
      return { error: BAD_NAME, ok: false }
    }

    const dir = parentDir(rel)
    const newRel = `${dir ? `${dir}/` : ''}${withMd(name)}`

    if (newRel !== rel && this.state.notes.some(item => item.rel !== rel && item.rel.toLowerCase() === newRel.toLowerCase())) {
      return { error: `"${noteTitle(newRel)}" already exists`, ok: false }
    }

    await this.save(rel)

    const resolveBefore = linkResolver(this.state.notes.map(item => item.rel))
    const sources = backlinksOf(this.state.graph, rel).filter(source => source !== rel)
    const res = await renameNote(this.fs, note.path, name)

    if (!res.ok) {
      return res
    }

    const next: VaultNote = { path: res.path, rel: newRel }
    const entry = this.cache.get(rel)

    this.cache.delete(rel)

    if (entry) {
      this.cache.set(newRel, { hash: entry.hash, index: { ...entry.index, rel: newRel } })
    }

    this.retab(rel, next)
    this.patch({
      graph: this.graphFor(this.state.notes.map(item => (item.rel === rel ? next : item))),
      notes: this.state.notes.map(item => (item.rel === rel ? next : item)).sort((a, b) => a.rel.localeCompare(b.rel))
    })
    await this.rewriteBacklinks(rel, newRel, resolveBefore, sources)

    return { ok: true }
  }

  /** Move a note to another folder, keeping path-qualified links valid. */
  async move(rel: string, destDirRel: string): Promise<Result> {
    const note = this.state.notes.find(item => item.rel === rel)

    if (!note || parentDir(rel) === destDirRel) {
      return { ok: true }
    }

    await this.save(rel)

    const newRel = `${destDirRel ? `${destDirRel}/` : ''}${rel.split('/').pop()}`
    const resolveBefore = linkResolver(this.state.notes.map(item => item.rel))
    const sources = backlinksOf(this.state.graph, rel).filter(source => source !== rel)
    const res = await moveNote(this.fs, note.path, dirPath(this.state.root, destDirRel))

    if (!res.ok) {
      return res
    }

    const next: VaultNote = { path: res.path, rel: newRel }
    const entry = this.cache.get(rel)

    this.cache.delete(rel)

    if (entry) {
      this.cache.set(newRel, { hash: entry.hash, index: { ...entry.index, rel: newRel } })
    }

    this.retab(rel, next)

    const notes = this.state.notes.map(item => (item.rel === rel ? next : item)).sort((a, b) => a.rel.localeCompare(b.rel))

    this.patch({ graph: this.graphFor(notes), notes })
    await this.rewriteBacklinks(rel, newRel, resolveBefore, sources)

    return { ok: true }
  }

  /** Move to the OS trash (recoverable). */
  async remove(rel: string): Promise<Result> {
    const note = this.state.notes.find(item => item.rel === rel)

    if (!note) {
      return { error: 'Note not found', ok: false }
    }

    const res = await trashNote(this.fs, note.path)

    if (!res.ok) {
      return res
    }

    this.retab(rel, null)
    this.dropNote(rel)
    this.persist()

    return { ok: true }
  }

  /**
   * Follow a wikilink (`Note`, `Note#Heading`, `Note#^block`): open the note and jump to the anchor.
   * A note that does not exist yet is created next to `fromRel` when `create` is set (a click on a
   * dangling link); otherwise the miss is reported — links that come from chat must never create files.
   */
  async follow(raw: string, fromRel: null | string, create = true): Promise<boolean> {
    const { anchor, note: target } = parseLinkTarget(raw)
    const resolved = linkResolver(this.state.notes.map(note => note.rel))(target)

    if (resolved) {
      this.open(resolved, anchor)

      return true
    }

    if (!create) {
      this.notify('error', this.t('warn.notFound', target))

      return false
    }

    const name = target.split('/').pop()!.replace(/\.md$/i, '').trim()
    const res = await this.create(fromRel ? parentDir(fromRel) : '', name)

    if (!res.ok) {
      this.notify('error', res.error)
    }

    return res.ok
  }

  // ---- per-vault view state --------------------------------------------------------------------

  private persist(): void {
    clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => this.persistNow(), PERSIST_MS)
  }

  private persistNow(): void {
    const { root, tabs, active, vault } = this.state

    if (root) {
      this.prefs.saveVault(root, { ...vault, active, tabs: tabs.map(tab => tab.rel) })
    }
  }

  updateVault(change: Partial<VaultState>): void {
    this.patch({ vault: { ...this.state.vault, ...change } })
    this.persist()
  }

  togglePin(rel: string): void {
    const { pinned } = this.state.vault

    this.updateVault({ pinned: pinned.includes(rel) ? pinned.filter(item => item !== rel) : [...pinned, rel] })
  }

  toggleFolderInGraph(folder: string): void {
    const { hiddenInGraph } = this.state.vault

    this.updateVault({
      hiddenInGraph: hiddenInGraph.includes(folder) ? hiddenInGraph.filter(item => item !== folder) : [...hiddenInGraph, folder]
    })
  }

  setPositions(positions: Record<string, [number, number]>): void {
    this.updateVault({ positions })
  }
}
