import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { EditorState, type Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
import { useEffect, useRef } from 'react'

import { computeMarks } from './md-highlight'

const WIKILINK_AT = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g

function decorate(doc: string): DecorationSet {
  const ranges: Range<Decoration>[] = computeMarks(doc).map(mark =>
    mark.line
      ? Decoration.line({ class: mark.cls }).range(mark.from)
      : Decoration.mark({ class: mark.cls }).range(mark.from, mark.to)
  )

  return Decoration.set(ranges, true)
}

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = decorate(view.state.doc.toString())
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = decorate(update.state.doc.toString())
      }
    }
  },
  { decorations: plugin => plugin.decorations }
)

/** The wikilink target at `offset` within `lineText`, if the offset falls inside one. */
export function wikilinkAt(lineText: string, offset: number): null | string {
  for (const match of lineText.matchAll(WIKILINK_AT)) {
    if (offset >= match.index && offset <= match.index + match[0].length) {
      return match[1]!.trim()
    }
  }

  return null
}

export interface EditorProps {
  /** Note titles offered after `[[`; read fresh on each completion. */
  getTitles: () => string[]
  initialValue: string
  onChange: (text: string) => void
  /** Ctrl/⌘-click on a wikilink. */
  onFollow: (target: string) => void
  onSave: () => void
}

/** CodeMirror 6 markdown editor. Reads `initialValue` once — remount (new `key`) to load another buffer. */
export function Editor(props: EditorProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const latest = useRef(props)

  latest.current = props

  useEffect(() => {
    const complete = (context: CompletionContext) => {
      const typed = context.matchBefore(/\[\[[^\]\n|#]*/)

      if (!typed) {
        return null
      }

      const closed = context.state.sliceDoc(context.pos, context.pos + 2) === ']]'

      return {
        from: typed.from + 2,
        options: latest.current.getTitles().map(title => ({ apply: closed ? title : `${title}]]`, label: title })),
        validFor: /^[^\]\n|#]*$/
      }
    }

    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: latest.current.initialValue,
        extensions: [
          history(),
          drawSelection(),
          highlighter,
          autocompletion({ activateOnTyping: true, override: [complete] }),
          EditorView.lineWrapping,
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (latest.current.onSave(), true) },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab
          ]),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              latest.current.onChange(update.state.doc.toString())
            }
          }),
          EditorView.domEventHandlers({
            mousedown(event, editor) {
              if (!(event.ctrlKey || event.metaKey)) {
                return false
              }

              const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY })

              if (pos === null) {
                return false
              }

              const line = editor.state.doc.lineAt(pos)
              const target = wikilinkAt(line.text, pos - line.from)

              if (!target) {
                return false
              }

              event.preventDefault()
              latest.current.onFollow(target)

              return true
            }
          })
        ]
      })
    })

    return () => view.destroy()
  }, [])

  return <div className="vc-editor" ref={host} />
}
