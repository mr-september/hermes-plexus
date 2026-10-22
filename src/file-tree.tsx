import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'

import { Codicon, usePluginI18n } from '@hermes/plugin-sdk'

import { PLUGIN_ID } from './i18n'
import { noteTitle, parentDir, type VaultNote } from './model'
import type { Result } from './vault-fs'

interface Dir {
  dirs: Map<string, Dir>
  files: VaultNote[]
  /** Vault-relative folder path, '' for the root. */
  rel: string
}

function buildTree(notes: readonly VaultNote[]): Dir {
  const root: Dir = { dirs: new Map(), files: [], rel: '' }

  for (const note of notes) {
    const parts = note.rel.split('/')
    let dir = root

    for (const [index, part] of parts.slice(0, -1).entries()) {
      if (!dir.dirs.has(part)) {
        dir.dirs.set(part, { dirs: new Map(), files: [], rel: parts.slice(0, index + 1).join('/') })
      }

      dir = dir.dirs.get(part)!
    }

    dir.files.push(note)
  }

  return root
}

interface Item {
  depth: number
  key: string
  kind: 'dir' | 'file'
  rel: string
}

/** The rows currently on screen, in order — the basis for keyboard navigation. */
function visibleItems(dir: Dir, expanded: ReadonlySet<string>, depth = 0): Item[] {
  const items: Item[] = []

  for (const [, child] of [...dir.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    items.push({ depth, key: `d:${child.rel}`, kind: 'dir', rel: child.rel })

    if (expanded.has(child.rel)) {
      items.push(...visibleItems(child, expanded, depth + 1))
    }
  }

  for (const note of dir.files) {
    items.push({ depth, key: `f:${note.rel}`, kind: 'file', rel: note.rel })
  }

  return items
}

type Editing = { dir: string; kind: 'new' } | { kind: 'rename'; rel: string }

export interface FileTreeProps {
  activeRel: null | string
  expanded: ReadonlySet<string>
  notes: readonly VaultNote[]
  onChangeVault: () => void
  onCreate: (dirRel: string, name: string) => Promise<Result>
  onDelete: (rel: string) => Promise<Result>
  onExpandedChange: (next: string[]) => void
  onMove: (rel: string, destDirRel: string) => Promise<Result>
  onOpen: (rel: string) => void
  onRename: (rel: string, name: string) => Promise<Result>
  onRescan: () => void
  onSwitchVault: (root: string) => void
  onToggleCollapse: () => void
  onToggleHidden: () => void
  root: string
  showHidden: boolean
  vaults: readonly string[]
}

const rootLabel = (root: string): string => root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root

export function FileTree(props: FileTreeProps) {
  const { activeRel, expanded, notes, onExpandedChange, onOpen } = props
  const t = usePluginI18n(PLUGIN_ID)
  const tree = useMemo(() => buildTree(notes), [notes])
  const items = useMemo(() => visibleItems(tree, expanded), [tree, expanded])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [armed, setArmed] = useState<null | string>(null)
  const [error, setError] = useState<null | string>(null)
  const [dropKey, setDropKey] = useState<null | string>(null)
  const [focusKey, setFocusKey] = useState<null | string>(null)
  const rows = useRef(new Map<string, HTMLElement>())

  // Reveal the active note: open its folders and bring its row into view.
  useEffect(() => {
    if (!activeRel) {
      return
    }

    const missing: string[] = []
    let dir = parentDir(activeRel)

    while (dir) {
      if (!expanded.has(dir)) {
        missing.push(dir)
      }

      dir = parentDir(dir)
    }

    if (missing.length) {
      onExpandedChange([...expanded, ...missing])
    } else {
      rows.current.get(`f:${activeRel}`)?.scrollIntoView?.({ block: 'nearest' })
    }
    // Only when the active note changes — folders the user collapses afterwards stay collapsed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRel, notes])

  const toggle = (rel: string) =>
    onExpandedChange(expanded.has(rel) ? [...expanded].filter(item => item !== rel) : [...expanded, rel])

  const commit = async (value: string) => {
    const action = editing

    setEditing(null)

    if (!action || !value.trim()) {
      return
    }

    const res = action.kind === 'new' ? await props.onCreate(action.dir, value) : await props.onRename(action.rel, value)

    setError(res.ok ? null : res.error)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') {
      return
    }

    const index = items.findIndex(item => item.key === focusKey)
    const item = items[index]

    const focusAt = (next: number) => {
      const target = items[Math.max(0, Math.min(items.length - 1, next))]

      if (target) {
        setFocusKey(target.key)
        rows.current.get(target.key)?.focus()
      }
    }

    if (event.key === 'ArrowDown') {
      focusAt(index + 1)
    } else if (event.key === 'ArrowUp') {
      focusAt(index - 1)
    } else if (event.key === 'ArrowRight' && item?.kind === 'dir' && !expanded.has(item.rel)) {
      toggle(item.rel)
    } else if (event.key === 'ArrowLeft' && item?.kind === 'dir' && expanded.has(item.rel)) {
      toggle(item.rel)
    } else if (event.key === 'Enter' && item) {
      item.kind === 'dir' ? toggle(item.rel) : onOpen(item.rel)
    } else if (event.key === 'F2' && item?.kind === 'file') {
      setEditing({ kind: 'rename', rel: item.rel })
    } else {
      return
    }

    event.preventDefault()
  }

  const nameInput = (initial: string, depth: number) => (
    <div className="vc-row" style={{ paddingLeft: depth * 12 + 4 }}>
      <input
        aria-label={t('tree.newNote')}
        autoFocus
        defaultValue={initial}
        onBlur={event => void commit(event.currentTarget.value)}
        onFocus={event => event.currentTarget.select()}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            setEditing(null)
          }
        }}
        style={{ flex: 1 }}
        type="text"
      />
    </div>
  )

  const drop = async (event: React.DragEvent, destDir: string) => {
    event.preventDefault()
    setDropKey(null)

    const rel = event.dataTransfer.getData('text/x-vault-rel')

    if (rel) {
      const res = await props.onMove(rel, destDir)

      setError(res.ok ? null : res.error)
    }
  }

  const dropProps = (key: string, destDir: string) => ({
    'data-drop': dropKey === key,
    onDragLeave: () => setDropKey(current => (current === key ? null : current)),
    onDragOver: (event: React.DragEvent) => {
      if (event.dataTransfer.types.includes('text/x-vault-rel')) {
        event.preventDefault()
        setDropKey(key)
      }
    },
    onDrop: (event: React.DragEvent) => void drop(event, destDir)
  })

  const renderDir = (dir: Dir, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = []

    for (const [name, child] of [...dir.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const key = `d:${child.rel}`
      const isOpen = expanded.has(child.rel)

      out.push(
        <div
          aria-expanded={isOpen}
          aria-level={depth + 1}
          className="vc-row"
          key={key}
          ref={el => void (el ? rows.current.set(key, el) : rows.current.delete(key))}
          role="treeitem"
          style={{ paddingLeft: depth * 12 + 4 }}
          tabIndex={(focusKey ?? items[0]?.key) === key ? 0 : -1}
          {...dropProps(key, child.rel)}
        >
          <button className="vc-grow" onClick={() => toggle(child.rel)} onFocus={() => setFocusKey(key)} tabIndex={-1} type="button">
            <Codicon name={isOpen ? 'chevron-down' : 'chevron-right'} size="0.75rem" />
            <Codicon name={isOpen ? 'folder-opened' : 'folder'} size="0.8rem" />
            <span className="vc-label">{name}</span>
          </button>
          <span className="vc-actions">
            <button
              aria-label={t('tree.newNoteHere')}
              onClick={() => {
                onExpandedChange([...expanded, child.rel])
                setEditing({ dir: child.rel, kind: 'new' })
              }}
              title={t('tree.newNoteHere')}
              type="button"
            >
              <Codicon name="add" size="0.8rem" />
            </button>
          </span>
        </div>
      )

      if (isOpen) {
        if (editing?.kind === 'new' && editing.dir === child.rel) {
          out.push(<div key={`n:${child.rel}`}>{nameInput('', depth + 1)}</div>)
        }

        out.push(...renderDir(child, depth + 1))
      }
    }

    for (const note of dir.files) {
      const key = `f:${note.rel}`

      if (editing?.kind === 'rename' && editing.rel === note.rel) {
        out.push(<div key={`r:${note.rel}`}>{nameInput(noteTitle(note.rel), depth)}</div>)

        continue
      }

      out.push(
        <div
          aria-level={depth + 1}
          aria-selected={note.rel === activeRel}
          className="vc-row"
          data-active={note.rel === activeRel}
          draggable
          key={key}
          onDragStart={event => {
            event.dataTransfer.setData('text/x-vault-rel', note.rel)
            event.dataTransfer.effectAllowed = 'move'
          }}
          ref={el => void (el ? rows.current.set(key, el) : rows.current.delete(key))}
          role="treeitem"
          style={{ paddingLeft: depth * 12 + 4 }}
          tabIndex={(focusKey ?? items[0]?.key) === key ? 0 : -1}
        >
          <button className="vc-grow" onClick={() => onOpen(note.rel)} onFocus={() => setFocusKey(key)} tabIndex={-1} type="button">
            <Codicon name="markdown" size="0.8rem" />
            <span className="vc-label">{noteTitle(note.rel)}</span>
          </button>
          {armed === note.rel ? (
            <button
              className="vc-danger"
              onBlur={() => setArmed(null)}
              onClick={() => {
                setArmed(null)
                void props.onDelete(note.rel).then(res => setError(res.ok ? null : res.error))
              }}
              type="button"
            >
              {t('tree.deleteConfirm')}
            </button>
          ) : (
            <span className="vc-actions">
              <button
                aria-label={t('common.rename')}
                onClick={() => setEditing({ kind: 'rename', rel: note.rel })}
                title={t('common.rename')}
                type="button"
              >
                <Codicon name="edit" size="0.8rem" />
              </button>
              <button aria-label={t('tree.trash')} onClick={() => setArmed(note.rel)} title={t('tree.trash')} type="button">
                <Codicon name="trash" size="0.8rem" />
              </button>
            </span>
          )}
        </div>
      )
    }

    return out
  }

  const icon = (name: string, label: string, onClick: () => void, on?: boolean) => (
    <button
      aria-label={label}
      aria-pressed={on}
      className={on ? 'vc-accent' : undefined}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span className="vc-icon">
        <Codicon name={name} size="0.85rem" />
      </span>
    </button>
  )

  return (
    <div className="vc-tree">
      <div className="vc-bar" {...dropProps('root', '')}>
        {props.vaults.length > 1 ? (
          <select
            aria-label={t('settings.vault')}
            className="vc-select"
            onChange={event => props.onSwitchVault(event.target.value)}
            value={props.root}
          >
            {props.vaults.map(vault => (
              <option key={vault} value={vault}>
                {rootLabel(vault)}
              </option>
            ))}
          </select>
        ) : (
          <span className="vc-bar-title" title={props.root}>
            {rootLabel(props.root)}
          </span>
        )}
        {icon('new-file', t('tree.newNote'), () => setEditing({ dir: '', kind: 'new' }))}
        {icon('refresh', t('tree.rescan'), props.onRescan)}
        {icon(
          'archive',
          props.showHidden ? t('tree.hideArchive') : t('tree.showArchive'),
          props.onToggleHidden,
          props.showHidden
        )}
        {icon('folder-library', t('tree.changeVault'), props.onChangeVault)}
        {icon('chevron-left', t('tree.collapse'), props.onToggleCollapse)}
      </div>
      {error && (
        <button className="vc-notice vc-danger" onClick={() => setError(null)} type="button">
          {error}
        </button>
      )}
      <div
        aria-label={rootLabel(props.root)}
        className="vc-tree-body"
        onKeyDown={onKeyDown}
        role="tree"
        {...dropProps('root-body', '')}
      >
        {editing?.kind === 'new' && editing.dir === '' && nameInput('', 0)}
        {renderDir(tree, 0)}
      </div>
    </div>
  )
}
