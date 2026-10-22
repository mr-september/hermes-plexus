import { useState } from 'react'

import { Codicon, host, usePluginI18n } from '@hermes/plugin-sdk'

import { Editor } from './editor'
import { PLUGIN_ID } from './i18n'
import { noteTitle } from './model'
import { NotePreview, type PreviewContext } from './preview'
import type { OpenNote } from './store'

export interface NotePaneProps {
  active: null | string
  backlinks: (rel: string) => string[]
  getTitles: () => string[]
  /** A pending jump to a heading/block in the note it names. */
  jump: null | { anchor: string; nonce: number; rel: string }
  notes: readonly OpenNote[]
  onActivate: (rel: string) => void
  onClose: (rel: string) => void
  onEdit: (rel: string, text: string) => void
  onFollow: (target: string, fromRel: string) => void
  onJumped: () => void
  onOpenRel: (rel: string) => void
  onReload: (rel: string) => void
  onSave: (rel: string, force?: boolean) => void
  preview: PreviewContext
}

export function NotePane(props: NotePaneProps) {
  const { active, notes } = props
  const t = usePluginI18n(PLUGIN_ID)
  const [preview, setPreview] = useState<ReadonlySet<string>>(new Set())
  const note = notes.find(item => item.rel === active)
  const jump = props.jump && props.jump.rel === active ? props.jump : null

  const togglePreview = (rel: string) => {
    const next = new Set(preview)

    if (!next.delete(rel)) {
      next.add(rel)
    }

    setPreview(next)
  }

  const status = (item: OpenNote): string =>
    item.saving ? t('note.saving') : item.draft !== item.base ? t('note.unsaved') : item.status === 'ready' ? t('note.saved') : ''

  const addToChat = (item: OpenNote) => {
    void host.composer?.insertText(null, `@file:${item.path}`, { mode: 'inline' })
  }

  return (
    <div className="vc-pane">
      <div aria-label="Open notes" className="vc-tabs" role="tablist">
        {notes.map(item => (
          <div aria-selected={item.rel === active} className="vc-tab" key={item.rel} role="tab">
            <button onClick={() => props.onActivate(item.rel)} title={item.rel} type="button">
              {noteTitle(item.rel)}
            </button>
            {item.draft !== item.base && <span aria-label={t('note.unsaved')} className="vc-unsaved" />}
            <button aria-label={t('common.close')} onClick={() => props.onClose(item.rel)} title={t('common.close')} type="button">
              <Codicon name="close" size="0.75rem" />
            </button>
          </div>
        ))}
      </div>

      {note ? (
        <>
          <div className="vc-subbar">
            <span className="vc-path">{note.rel}</span>
            <span aria-live="polite">{status(note)}</span>
            {host.composer && (
              <button className="vc-pill" onClick={() => addToChat(note)} title={t('note.addToChat')} type="button">
                {t('note.addToChat')}
              </button>
            )}
            <button className="vc-pill" onClick={() => togglePreview(note.rel)} type="button">
              {preview.has(note.rel) ? t('note.edit') : t('note.preview')}
            </button>
          </div>

          {note.status === 'conflict' && (
            <div className="vc-banner vc-danger" role="alert">
              <span style={{ flex: 1 }}>{note.error ?? t('note.changedOnDisk')}</span>
              <button className="vc-pill" onClick={() => props.onReload(note.rel)} type="button">
                {t('note.reload')}
              </button>
              <button className="vc-pill" onClick={() => props.onSave(note.rel, true)} type="button">
                {t('note.overwrite')}
              </button>
            </div>
          )}
          {note.status === 'error' && (
            <div className="vc-banner vc-danger" role="alert">
              {note.error}
            </div>
          )}
          {!note.editable && note.status === 'ready' && <div className="vc-banner vc-dim">{t('note.readOnly')}</div>}

          <div className="vc-body">
            {note.status === 'loading' ? (
              <div className="vc-banner vc-dim">{t('note.loading')}</div>
            ) : preview.has(note.rel) || !note.editable ? (
              <NotePreview
                anchor={jump?.anchor}
                ctx={props.preview}
                jumpNonce={jump?.nonce}
                onJumped={props.onJumped}
                rel={note.rel}
                text={note.draft}
              />
            ) : (
              <Editor
                getTitles={props.getTitles}
                initialValue={note.draft}
                jump={jump}
                key={`${note.rel}:${note.generation}`}
                onJumped={props.onJumped}
                onChange={text => props.onEdit(note.rel, text)}
                onFollow={target => props.onFollow(target, note.rel)}
                onSave={() => props.onSave(note.rel)}
              />
            )}
          </div>

          {props.backlinks(note.rel).length > 0 && (
            <div className="vc-backlinks">
              <span style={{ marginRight: 6 }}>{t('note.backlinks')}</span>
              {props.backlinks(note.rel).map(rel => (
                <button key={rel} onClick={() => props.onOpenRel(rel)} type="button">
                  {noteTitle(rel)}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="vc-banner vc-dim">{t('empty.openNote')}</div>
      )}
    </div>
  )
}
