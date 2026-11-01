/**
 * Recovery controls for hidden folders: one chip per saved entry that the top-level legend chips do not already
 * represent (deeper paths, and entries whose folder is not in the current scan, at any depth), plus "Show all".
 * Shared by the graph legend and the empty-scan message, so every saved entry always has a control.
 */

import { usePluginI18n } from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef } from 'react'

import { knownFolders, subtreeCount } from './hidden'
import { PLUGIN_ID } from './i18n'
import type { GraphNode } from './model'

export interface HiddenControlsProps {
  /** Saved entries, in the order they were added. */
  entries: readonly string[]
  /** Top-level folders (and `''`) that the legend already shows as chips. */
  legendFolders: readonly string[]
  /** The unfiltered scan. */
  nodes: readonly Pick<GraphNode, 'dir'>[]
  onClear: () => void
  onShow: (path: string) => void
}

export function HiddenControls({ entries, legendFolders, nodes, onClear, onShow }: HiddenControlsProps) {
  const t = usePluginI18n(PLUGIN_ID)
  const root = useRef<HTMLDivElement | null>(null)
  const refocus = useRef<null | number>(null)
  const fallback = useRef<HTMLElement | null>(null)
  const known = useMemo(() => knownFolders(nodes), [nodes])
  const represented = useMemo(() => new Set(legendFolders), [legendFolders])
  const listed = entries.filter(entry => !represented.has(entry))
  const counts = useMemo(() => new Map(listed.map(entry => [entry, subtreeCount(nodes, entry)])), [listed.join('\0'), nodes])

  // When the activated control disappears, focus moves to the control now in its place, else the graph.
  useEffect(() => {
    if (refocus.current === null) {
      return
    }

    const controls = root.current?.querySelectorAll<HTMLButtonElement>('button[data-recovery]') ?? []
    const next = controls[Math.min(refocus.current, controls.length - 1)] ?? fallback.current

    refocus.current = null
    fallback.current = null
    next?.focus()
  }, [entries])

  if (!listed.length && entries.length < 2) {
    return null
  }

  const act = (event: React.MouseEvent<HTMLButtonElement>, run: () => void) => {
    const all = [...(root.current?.querySelectorAll('button[data-recovery]') ?? [])]

    refocus.current = Math.max(0, all.indexOf(event.currentTarget))
    fallback.current = root.current?.closest('.vc-graph')?.querySelector<HTMLElement>('canvas.vc-canvas')
      ?? root.current?.closest<HTMLElement>('.vc-empty') ?? null
    run()
  }

  return (
    <div aria-label={t('graph.hiddenGroup')} className="vc-hidden" ref={root} role="group">
      <span>{t('graph.hiddenGroup')}:</span>
      {listed.map(entry => {
        const name = entry === '' ? t('graph.rootNotes') : entry
        const stale = !known.has(entry)

        return (
          <button
            aria-label={t('graph.showFolder', name)}
            data-recovery
            data-stale={stale}
            key={entry}
            onClick={event => act(event, () => onShow(entry))}
            title={stale ? t('graph.notInScan') : t('graph.subtree', counts.get(entry) ?? 0)}
            type="button"
          >
            {stale ? `${name} (${t('graph.notInScan')})` : `${name} · ${counts.get(entry) ?? 0}`}
          </button>
        )
      })}
      {entries.length >= 2 && (
        <button data-recovery onClick={event => act(event, onClear)} type="button">
          {t('graph.showAll')}
        </button>
      )}
    </div>
  )
}
