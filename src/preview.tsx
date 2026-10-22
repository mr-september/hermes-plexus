import { useEffect, useMemo, useRef, useState } from 'react'

import { Streamdown, usePluginI18n } from '@hermes/plugin-sdk'

import { PLUGIN_ID } from './i18n'
import { noteTitle, parseLinkTarget, sectionOf, splitPreview, stripFrontmatter, wikilinksToMarkdown } from './model'

/** What the preview needs from the vault; injected so it stays testable and free of store details. */
export interface PreviewContext {
  imageUrl: (assetRel: string) => Promise<null | string>
  noteText: (rel: string) => Promise<null | string>
  onFollow: (raw: string, fromRel: string) => void
  resolveAsset: (target: string, fromRel: string) => string | undefined
  /** A link target (without anchor) to the note it names. */
  resolveNote: (target: string) => string | undefined
}

/** Notes embedded inside embedded notes stop here. */
const MAX_DEPTH = 2

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase()

interface PreviewProps {
  /** Heading to scroll to once rendered. */
  anchor?: null | string
  ctx: PreviewContext
  depth?: number
  /** Re-run the scroll when this changes (a repeated jump to the same heading). */
  jumpNonce?: number
  /** The pending jump has been attempted, so it must not repeat on a later remount. */
  onJumped?: () => void
  rel: string
  text: string
  /** Notes already being rendered above this one (cycle guard for embeds). */
  trail?: readonly string[]
}

export function NotePreview({ anchor, ctx, depth = 0, jumpNonce, onJumped, rel, text, trail = [] }: PreviewProps) {
  const root = useRef<HTMLDivElement | null>(null)
  const segments = useMemo(() => splitPreview(stripFrontmatter(text)), [text])

  useEffect(() => {
    if (!anchor || anchor.startsWith('^')) {
      return
    }

    const wanted = normalizeText(anchor.replace(/[*_`~[\]]/g, ''))

    const heading = [...(root.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])].find(
      el => normalizeText(el.textContent ?? '') === wanted
    )

    heading?.scrollIntoView?.({ block: 'start' })
    onJumped?.()
    // `onJumped` is a stable store call; the scroll re-runs only for a new jump or new text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, jumpNonce, text])

  return (
    <div
      className="vc-preview"
      onClick={event => {
        const href = (event.target as HTMLElement).closest('a')?.getAttribute('href') ?? ''

        if (href.startsWith('#vault/')) {
          event.preventDefault()
          ctx.onFollow(decodeURIComponent(href.slice(7)), rel)
        }
      }}
      ref={root}
    >
      {segments.map((segment, index) =>
        segment.kind === 'md' ? (
          segment.text.trim() ? <Streamdown key={index}>{wikilinksToMarkdown(segment.text)}</Streamdown> : null
        ) : segment.kind === 'image' ? (
          <PreviewImage ctx={ctx} fromRel={rel} key={index} segment={segment} />
        ) : (
          <EmbeddedNote
            anchor={segment.anchor}
            ctx={ctx}
            depth={depth}
            fromRel={rel}
            key={index}
            target={segment.target}
            trail={[...trail, rel]}
          />
        )
      )}
    </div>
  )
}

function PreviewImage({
  ctx,
  fromRel,
  segment
}: {
  ctx: PreviewContext
  fromRel: string
  segment: { alt: string; target: string; width: null | number }
}) {
  const t = usePluginI18n(PLUGIN_ID)
  const [state, setState] = useState<{ url: null | string } | null>(null)
  const assetRel = ctx.resolveAsset(segment.target, fromRel)

  useEffect(() => {
    let live = true

    setState(null)

    if (assetRel) {
      void ctx.imageUrl(assetRel).then(url => live && setState({ url }))
    } else {
      setState({ url: null })
    }

    return () => {
      live = false
    }
  }, [assetRel, ctx])

  if (state?.url) {
    return (
      <img
        alt={segment.alt || noteTitle(segment.target)}
        src={state.url}
        style={{ display: 'block', height: 'auto', maxWidth: '100%', width: segment.width ?? undefined }}
      />
    )
  }

  return state ? <div className="vc-dim">{t('preview.imageMissing', segment.target)}</div> : null
}

function EmbeddedNote({
  anchor,
  ctx,
  depth,
  fromRel,
  target,
  trail
}: {
  anchor: null | string
  ctx: PreviewContext
  depth: number
  fromRel: string
  target: string
  trail: readonly string[]
}) {
  const t = usePluginI18n(PLUGIN_ID)
  const rel = ctx.resolveNote(parseLinkTarget(target).note)
  const [text, setText] = useState<null | string | undefined>(undefined)
  const blocked = depth >= MAX_DEPTH || (rel !== undefined && trail.includes(rel))

  useEffect(() => {
    let live = true

    setText(undefined)

    if (rel && !blocked) {
      void ctx.noteText(rel).then(value => live && setText(value))
    }

    return () => {
      live = false
    }
  }, [blocked, ctx, rel])

  if (!rel) {
    return <div className="vc-dim">{t('preview.embedMissing', target)}</div>
  }

  return (
    <div className="vc-embed">
      <button
        className="vc-embed-title"
        onClick={() => ctx.onFollow(anchor ? `${rel}#${anchor}` : rel, fromRel)}
        title={t('preview.openEmbedded')}
        type="button"
      >
        ↪ {noteTitle(rel)}
        {anchor ? ` › ${anchor}` : ''}
      </button>
      {blocked ? (
        <div className="vc-dim">{t('preview.embedTooDeep')}</div>
      ) : text ? (
        <NotePreview ctx={ctx} depth={depth + 1} rel={rel} text={sectionOf(text, anchor)} trail={trail} />
      ) : text === null ? (
        <div className="vc-dim">{t('preview.embedMissing', target)}</div>
      ) : null}
    </div>
  )
}
