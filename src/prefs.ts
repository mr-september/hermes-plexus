/**
 * Preferences and per-vault state, persisted with the SDK's plugin storage
 * (`ctx.storage`, keys namespaced to this plugin). Persistence is a convenience:
 * every read and write is guarded so the workspace works without it.
 */

import type { PluginStorage } from '@hermes/plugin-sdk'

export type ClusterMode = 'folder' | 'none'
export type LabelMode = 'always' | 'auto' | 'never'

export interface Prefs {
  /** Milliseconds of idle typing before a note is saved. */
  autosaveMs: number
  cluster: ClusterMode
  /** Folder names skipped when scanning (case-insensitive). */
  hiddenFolders: string[]
  labels: LabelMode
  /** Fraction of the graph/notes area given to the note pane (0 hides it, 1 hides the graph). */
  noteFrac: number
  /** Load images that notes link from the web when previewing (the image's host sees the request). Off by default. */
  remoteImages: boolean
  showHidden: boolean
  showOrphans: boolean
  treeOpen: boolean
  /** The vault in use plus recently used ones, for the switcher. */
  vaultRoot: string
  vaults: string[]
}

export const DEFAULT_PREFS: Prefs = {
  autosaveMs: 800,
  cluster: 'folder',
  hiddenFolders: ['archive', '_archived'],
  labels: 'auto',
  noteFrac: 0.5,
  remoteImages: false,
  showHidden: false,
  showOrphans: true,
  treeOpen: true,
  vaultRoot: '',
  vaults: []
}

/** What is remembered per vault. */
export interface VaultState {
  active: null | string
  expanded: string[]
  /** Folders hidden from the graph via the legend. */
  hiddenInGraph: string[]
  /** Open note tabs, by vault-relative path. */
  tabs: string[]
  /** Last settled node positions, so the graph does not reshuffle on every open. */
  positions: Record<string, [number, number]>
  /** Nodes pinned in place. */
  pinned: string[]
}

export const EMPTY_VAULT_STATE: VaultState = {
  active: null,
  expanded: [],
  hiddenInGraph: [],
  pinned: [],
  positions: {},
  tabs: []
}

const vaultKey = (root: string): string => `vault:${root.toLowerCase().replace(/[\\/]+$/, '')}`

export class PrefsStore {
  private listeners = new Set<() => void>()
  private snapshot: Prefs

  constructor(private storage: null | PluginStorage) {
    this.snapshot = this.read()
  }

  private read(): Prefs {
    try {
      return { ...DEFAULT_PREFS, ...this.storage?.get<Partial<Prefs>>('prefs', {}) }
    } catch {
      return DEFAULT_PREFS
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)

    return () => void this.listeners.delete(listener)
  }

  get = (): Prefs => this.snapshot

  set(change: Partial<Prefs>): void {
    this.snapshot = { ...this.snapshot, ...change }

    try {
      this.storage?.set('prefs', this.snapshot)
    } catch {
      // Persistence is a convenience; the in-memory value still applies.
    }

    this.listeners.forEach(listener => listener())
  }

  /** Make `root` the active vault and remember it in the recent list. */
  useVault(root: string): void {
    this.set({ vaultRoot: root, vaults: [root, ...this.snapshot.vaults.filter(v => v !== root)].slice(0, 8) })
  }

  loadVault(root: string): VaultState {
    try {
      return { ...EMPTY_VAULT_STATE, ...this.storage?.get<Partial<VaultState>>(vaultKey(root), {}) }
    } catch {
      return EMPTY_VAULT_STATE
    }
  }

  saveVault(root: string, state: VaultState): void {
    try {
      this.storage?.set(vaultKey(root), state)
    } catch {
      // See `set`.
    }
  }
}
