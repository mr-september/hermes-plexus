import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { Codicon, usePluginI18n } from '@hermes/plugin-sdk'

import { NO_ACCESS, type VaultFs } from './files'
import { FileTree } from './file-tree'
import { GraphView } from './graph-view'
import { PLUGIN_ID } from './i18n'
import { assetResolver, backlinksOf, clampSplit, filterGraph, linkResolver, noteTitle } from './model'
import { NotePane } from './note-pane'
import type { PrefsStore } from './prefs'
import type { PreviewContext } from './preview'
import type { VaultStore } from './store'
import { chooseVaultFolder } from './vault-fs'

/** Above this many notes a focus rescan lists folders only, instead of re-reading every note. */
const FULL_RESCAN_LIMIT = 1500

const STEP = 0.05

export interface WorkspaceProps {
  fs: VaultFs
  prefs: PrefsStore
  store: VaultStore
}

export function VaultWorkspace({ fs, prefs: prefsStore, store }: WorkspaceProps) {
  const t = usePluginI18n(PLUGIN_ID)
  const state = useSyncExternalStore(store.subscribe, store.get)
  const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.get)
  const areaRef = useRef<HTMLDivElement | null>(null)
  const [search, setSearch] = useState('')
  const [local, setLocal] = useState(false)

  // Rescan after the window regains focus (edits made elsewhere): cheap at vault scale.
  useEffect(() => {
    const onFocus = () => void store.scan(store.get().notes.length < FULL_RESCAN_LIMIT ? 'full' : 'dirs')

    window.addEventListener('focus', onFocus)

    return () => window.removeEventListener('focus', onFocus)
  }, [store])

  // Flush unsaved edits when the window loses focus.
  useEffect(() => {
    const onBlur = () => void store.flushAll()

    window.addEventListener('blur', onBlur)

    return () => window.removeEventListener('blur', onBlur)
  }, [store])

  const { active, graph, notes, root, tabs, vault } = state

  const hiddenInGraph = useMemo(() => new Set(vault.hiddenInGraph), [vault.hiddenInGraph])
  const pinned = useMemo(() => new Set(vault.pinned), [vault.pinned])
  const expanded = useMemo(() => new Set(vault.expanded), [vault.expanded])
  const openRels = useMemo(() => new Set(tabs.map(tab => tab.rel)), [tabs])

  const shown = useMemo(
    () =>
      filterGraph(graph, {
        hiddenFolders: hiddenInGraph,
        local: local && active ? { depth: 1, rel: active } : null,
        showOrphans: prefs.showOrphans
      }),
    [active, graph, hiddenInGraph, local, prefs.showOrphans]
  )

  const legendFolders = useMemo(() => [...new Set(graph.nodes.map(node => node.folder))].sort(), [graph])

  const getTitles = useCallback(() => store.get().notes.map(note => noteTitle(note.rel)), [store])

  const resolveAsset = useMemo(() => assetResolver(state.assets.map(asset => asset.rel)), [state.assets])
  const resolveNote = useMemo(() => linkResolver(notes.map(note => note.rel)), [notes])

  const previewCtx = useMemo<PreviewContext>(
    () => ({
      imageUrl: rel => store.imageUrl(rel),
      noteText: rel => store.noteText(rel),
      onFollow: (raw, from) => void store.follow(raw, from),
      onLoadRemoteImages: () => prefsStore.set({ remoteImages: true }),
      remoteImages: prefs.remoteImages,
      resolveAsset: (target, from) => resolveAsset(target, from),
      resolveNote: target => resolveNote(target)
    }),
    [prefs.remoteImages, prefsStore, resolveAsset, resolveNote, store]
  )

  const warnings = state.status.warnings ?? []
  const warningKey = warnings.map(item => `${item.kind}:${item.path}`).join('|')
  const [dismissedWarnings, setDismissedWarnings] = useState('')

  const pickVault = async () => {
    const picked = await chooseVaultFolder(fs)

    if (picked) {
      prefsStore.useVault(picked)
    }
  }

  const openRel = useCallback(
    (rel: string) => {
      store.open(rel)

      // Opening a note from a collapsed pane brings the pane back.
      if (prefsStore.get().noteFrac === 0) {
        prefsStore.set({ noteFrac: 0.5 })
      }
    },
    [prefsStore, store]
  )

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const area = areaRef.current

    if (!area) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)

    const rect = area.getBoundingClientRect()
    const move = (e: PointerEvent) => prefsStore.set({ noteFrac: clampSplit(1 - (e.clientX - rect.left) / rect.width) })

    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  if (!root) {
    return (
      <div className="vc-root">
        <div className="vc-empty">
          <Codicon name="folder-library" size="2rem" />
          <div>{t('empty.chooseHint')}</div>
          <button className="vc-btn" onClick={() => void pickVault()} type="button">
            {t('empty.chooseVault')}
          </button>
        </div>
      </div>
    )
  }

  const hasNotes = tabs.length > 0
  const frac = hasNotes ? prefs.noteFrac : 0

  return (
    <div className="vc-root">
      <div className="vc-tree-col" style={{ width: prefs.treeOpen ? '15rem' : '1.75rem' }}>
        {prefs.treeOpen ? (
          <FileTree
            activeRel={active}
            expanded={expanded}
            notes={notes}
            onChangeVault={() => void pickVault()}
            onCreate={(dir, name) => store.create(dir, name)}
            onDelete={rel => store.remove(rel)}
            onExpandedChange={next => store.updateVault({ expanded: next })}
            onMove={(rel, dest) => store.move(rel, dest)}
            onOpen={openRel}
            onRename={(rel, name) => store.rename(rel, name)}
            onRescan={() => void store.scan('full')}
            onSwitchVault={next => prefsStore.useVault(next)}
            onToggleCollapse={() => prefsStore.set({ treeOpen: false })}
            onToggleHidden={() => prefsStore.set({ showHidden: !prefs.showHidden })}
            root={root}
            showHidden={prefs.showHidden}
            vaults={prefs.vaults}
          />
        ) : (
          <button
            aria-label={t('tree.expand')}
            className="vc-icon"
            onClick={() => prefsStore.set({ treeOpen: true })}
            style={{ height: '2rem', width: '100%' }}
            title={t('tree.expand')}
            type="button"
          >
            <Codicon name="chevron-right" size="0.8rem" />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
        {warningKey && warningKey !== dismissedWarnings && (
          <div className="vc-banner vc-danger" role="alert">
            <span style={{ flex: 1 }}>{warnings.map(item => t(`warn.${item.kind}`, item.path)).join(' ')}</span>
            <button className="vc-btn" onClick={() => setDismissedWarnings(warningKey)} type="button">
              {t('warn.dismiss')}
            </button>
          </div>
        )}
        {state.notice && (
          <button
            className={`vc-notice ${state.notice.kind === 'error' ? 'vc-danger' : 'vc-dim'}`}
            onClick={() => store.dismissNotice()}
            role="status"
            type="button"
          >
            {state.notice.text}
          </button>
        )}
        <div
          className="vc-main"
          ref={areaRef}
          style={{
            gridTemplateColumns: hasNotes ? `minmax(0,${1 - frac}fr) 6px minmax(0,${frac}fr)` : 'minmax(0,1fr)'
          }}
        >
          <div className="vc-graph-wrap" style={{ minHeight: 0, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
            {state.status.error ? (
              <div className="vc-banner vc-danger">
                <span style={{ flex: 1 }}>{state.status.error === NO_ACCESS ? t('empty.noAccess') : state.status.error}</span>
                <button className="vc-btn" onClick={() => void pickVault()} type="button">
                  {t('empty.chooseVault')}
                </button>
              </div>
            ) : !state.status.loading && notes.length === 0 ? (
              <div className="vc-empty">{t('empty.noNotes')}</div>
            ) : (
              <GraphView
                cluster={prefs.cluster}
                graph={shown}
                hiddenFolders={hiddenInGraph}
                labels={prefs.labels}
                legendFolders={legendFolders}
                onOpen={openRel}
                onPositions={positions => store.setPositions(positions)}
                onToggleFolder={folder => store.toggleFolderInGraph(folder)}
                onTogglePin={rel => store.togglePin(rel)}
                openRels={openRels}
                pinned={pinned}
                positions={vault.positions}
                search={search}
                selected={active}
                touched={state.touched}
              />
            )}
            <div className="vc-toolbar">
              <input
                aria-label={t('graph.search')}
                onChange={event => setSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setSearch('')
                  }
                }}
                placeholder={t('graph.search')}
                type="search"
                value={search}
              />
              <button
                aria-pressed={local}
                className="vc-toggle"
                data-on={local}
                disabled={!active}
                onClick={() => setLocal(!local)}
                title={t('graph.local')}
                type="button"
              >
                <Codicon name="target" size="0.85rem" />
              </button>
              <button
                aria-pressed={prefs.showOrphans}
                className="vc-toggle"
                data-on={prefs.showOrphans}
                onClick={() => prefsStore.set({ showOrphans: !prefs.showOrphans })}
                title={t('graph.orphans')}
                type="button"
              >
                <Codicon name="circle-small" size="0.95rem" />
              </button>
              {state.status.loading && <span className="vc-dim">…</span>}
            </div>
          </div>

          {hasNotes && (
            <>
              <div
                aria-orientation="vertical"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(frac * 100)}
                className="vc-split"
                onDoubleClick={() => prefsStore.set({ noteFrac: 0.5 })}
                onKeyDown={event => {
                  const delta = event.key === 'ArrowLeft' ? STEP : event.key === 'ArrowRight' ? -STEP : 0

                  if (delta) {
                    event.preventDefault()
                    prefsStore.set({ noteFrac: clampSplit(frac + delta) })
                  }
                }}
                onPointerDown={startDrag}
                role="separator"
                tabIndex={0}
              />
              <div style={{ minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
                <NotePane
                  active={active}
                  backlinks={rel => backlinksOf(graph, rel)}
                  getTitles={getTitles}
                  jump={state.jump}
                  notes={tabs}
                  onActivate={rel => store.activate(rel)}
                  onClose={rel => void store.close(rel)}
                  onEdit={(rel, text) => store.edit(rel, text)}
                  onFollow={(target, from) => void store.follow(target, from)}
                  onJumped={() => store.clearJump()}
                  onOpenRel={openRel}
                  onReload={rel => store.reload(rel)}
                  onSave={(rel, force) => void store.save(rel, force)}
                  preview={previewCtx}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
