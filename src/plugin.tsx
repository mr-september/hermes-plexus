/**
 * Vault Constellation — a Hermes Desktop plugin that opens a local markdown vault as ONE
 * tab in the main workspace zone: a collapsible file tree, a force-directed graph of notes
 * and their [[wikilinks]], and a tabbed editor pane behind a divider that can collapse
 * either side entirely.
 *
 * Local only. Notes are read and written through the desktop app's Electron file bridge on
 * this machine; there is no backend, REST route or network access.
 */

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
import { PrefsStore } from './prefs'
import { VaultSettings } from './settings'
import { VaultStore } from './store'
import { installStyles } from './styles'
import { VaultWorkspace } from './workspace'

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

    const open = () => {
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

    ctx.registerMany([
      {
        area: PALETTE_AREA,
        data: {
          id: 'vault-constellation.open',
          keywords: ['vault', 'notes', 'obsidian', 'graph', 'wiki', 'constellation'],
          label: ctx.i18n.t('vault.open'),
          run: open
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
          run: open
        } satisfies KeybindContribution,
        id: 'open'
      }
    ])
  }
}

export default plugin
