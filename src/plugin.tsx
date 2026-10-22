/**
 * Vault Constellation — a Hermes Desktop plugin that opens a local markdown vault as ONE
 * tab in the main workspace zone: a collapsible file tree, a force-directed graph of notes
 * and their [[wikilinks]], and a tabbed editor pane behind a divider that can collapse
 * either side entirely.
 *
 * Local only. Notes are read and written through the desktop app's Electron file bridge on
 * this machine; there is no backend, REST route or network access.
 */

import * as sdk from '@hermes/plugin-sdk'
import {
  type HermesPlugin,
  host,
  type KeybindContribution,
  KEYBINDS_AREA,
  PALETTE_AREA,
  type PaletteContribution
} from '@hermes/plugin-sdk'

import { getBridge } from './bridge'
import { en, PLUGIN_ID } from './i18n'
import { noteTitle, parseLinkTarget } from './model'
import { PrefsStore } from './prefs'
import { VaultSettings } from './settings'
import { VaultStore } from './store'
import { installStyles } from './styles'
import { VaultWorkspace } from './workspace'

/** The transcript directive the agent writes to link a note: `::vault{note="Folder/Note#Heading"}`. */
export const DIRECTIVE_NAME = 'vault'

const SAFE_TARGET = /^[^\u0000-\u001f]{1,300}$/

const plugin: HermesPlugin = {
  description: 'Browse and edit a local markdown vault as a note graph.',
  id: PLUGIN_ID,
  name: 'Vault Constellation',
  register(ctx) {
    const fs = getBridge()

    ctx.onDispose(installStyles())
    ctx.onDispose(ctx.i18n.register({ en }))

    if (!fs) {
      // Without Electron's file bridge (web build, older shell) there is nothing to open.
      return
    }

    const prefs = new PrefsStore(ctx.storage)
    let store: null | VaultStore = null
    let close: (() => void) | null = null

    /** Open (or re-front) the workspace tab, creating its store on first use. */
    const open = (): VaultStore => {
      if (!store) {
        store = new VaultStore(fs, prefs, ctx.i18n.t)
        store.start()
      }

      const current = store

      close = host.openWorkspace(PLUGIN_ID, {
        minWidth: '36rem',
        onClose: () => {
          void current.dispose()

          if (store === current) {
            store = null
          }

          close = null
        },
        render: () => <VaultWorkspace fs={fs} prefs={prefs} store={current} />,
        title: ctx.i18n.t('vault.title')
      })

      return current
    }

    /** Open a note named in chat. A name that does not exist is reported, never created. */
    const openNote = async (target: string): Promise<void> => {
      const current = open()

      if (await current.whenReady()) {
        await current.follow(target, null, false)
      }
    }

    ctx.onDispose(() => {
      close?.()
    })

    ctx.registerSettingsPage?.({
      icon: 'type-hierarchy',
      id: 'settings',
      render: () => <VaultSettings fs={fs} prefs={prefs} />,
      title: ctx.i18n.t('vault.title')
    })

    const contributions = [
      {
        area: PALETTE_AREA,
        data: {
          id: 'vault-constellation.open',
          keywords: ['vault', 'notes', 'obsidian', 'graph', 'wiki', 'constellation'],
          label: ctx.i18n.t('vault.open'),
          run: () => void open()
        } satisfies PaletteContribution,
        id: 'open'
      },
      {
        area: KEYBINDS_AREA,
        data: {
          category: 'view',
          defaults: ['mod+shift+g'],
          id: 'vault-constellation.open',
          label: ctx.i18n.t('vault.open'),
          run: () => void open()
        } satisfies KeybindContribution,
        id: 'open'
      }
    ]

    // Older desktops predate transcript directives; feature-detect instead of importing the name.
    const directiveArea = (sdk as { TRANSCRIPT_DIRECTIVE_AREA?: string }).TRANSCRIPT_DIRECTIVE_AREA

    if (directiveArea) {
      contributions.push({
        area: directiveArea,
        data: {
          name: DIRECTIVE_NAME,
          render: ({ attrs, source }: { attrs: Readonly<Record<string, string>>; source: string }) => {
            const target = (attrs.note ?? '').trim()

            // Attributes are untrusted model output: anything odd stays the text it was.
            if (!SAFE_TARGET.test(target)) {
              return <span>{source}</span>
            }

            const { anchor, note } = parseLinkTarget(target)
            const label = `${noteTitle(note)}${anchor ? ` › ${anchor}` : ''}`

            return (
              <button
                className="vc-chip"
                onClick={() => void openNote(target)}
                title={ctx.i18n.t('vault.noteLink', label)}
                type="button"
              >
                {label}
              </button>
            )
          }
        } as never,
        id: 'note-link'
      })
    }

    ctx.registerMany(contributions)
  }
}

export default plugin
