import { useSyncExternalStore } from 'react'

import { usePluginI18n } from '@hermes/plugin-sdk'

import type { VaultFs } from './files'
import { PLUGIN_ID } from './i18n'
import type { ClusterMode, LabelMode, PrefsStore } from './prefs'
import { chooseVaultFolder } from './vault-fs'

/** Settings → Plugins → Vault. Everything here applies live to an open workspace. */
export function VaultSettings({ fs, prefs: store }: { fs: VaultFs; prefs: PrefsStore }) {
  const t = usePluginI18n(PLUGIN_ID)
  const prefs = useSyncExternalStore(store.subscribe, store.get)

  return (
    <div className="vc-root vc-settings" style={{ height: 'auto' }}>
      <label>
        <span>{t('settings.vault')}</span>
        <input readOnly type="text" value={prefs.vaultRoot} />
        <button
          className="vc-btn"
          onClick={() => {
            void chooseVaultFolder(fs).then(picked => picked && store.useVault(picked))
          }}
          type="button"
        >
          {t('settings.chooseVault')}
        </button>
      </label>
      <label>
        <span>{t('settings.hiddenFolders')}</span>
        <input
          defaultValue={prefs.hiddenFolders.join(', ')}
          onBlur={event =>
            store.set({
              hiddenFolders: event.target.value
                .split(',')
                .map(name => name.trim())
                .filter(Boolean)
            })
          }
          type="text"
        />
      </label>
      <label>
        <span>{t('settings.autosave')}</span>
        <input
          defaultValue={prefs.autosaveMs}
          min={200}
          onBlur={event => store.set({ autosaveMs: Math.max(200, Number(event.target.value) || 800) })}
          step={100}
          type="number"
        />
      </label>
      <label>
        <span>{t('settings.cluster')}</span>
        <select
          onChange={event => store.set({ cluster: event.target.value as ClusterMode })}
          value={prefs.cluster}
        >
          <option value="folder">{t('graph.clusterFolder')}</option>
          <option value="none">–</option>
        </select>
      </label>
      <label>
        <span>{t('settings.labels')}</span>
        <select onChange={event => store.set({ labels: event.target.value as LabelMode })} value={prefs.labels}>
          <option value="auto">{t('settings.labelsAuto')}</option>
          <option value="always">{t('settings.labelsAlways')}</option>
          <option value="never">{t('settings.labelsNever')}</option>
        </select>
      </label>
      <label>
        <span>{t('settings.orphans')}</span>
        <input
          checked={prefs.showOrphans}
          onChange={event => store.set({ showOrphans: event.target.checked })}
          type="checkbox"
        />
      </label>
      <label>
        <span>{t('settings.remoteImages')}</span>
        <input
          checked={prefs.remoteImages}
          onChange={event => store.set({ remoteImages: event.target.checked })}
          type="checkbox"
        />
      </label>
    </div>
  )
}
