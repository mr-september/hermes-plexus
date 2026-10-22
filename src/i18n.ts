/**
 * UI strings. Registered through the SDK's plugin i18n (`ctx.i18n.register`) so Hermes can
 * resolve them against the user's language; any locale without a bundle falls back to English.
 * Add a language by adding a sibling object here — keys must match `en`.
 */

export const PLUGIN_ID = 'hermes-plexus'

export const en = {
  common: { cancel: 'Cancel', close: 'Close', delete: 'Delete', rename: 'Rename' },
  empty: {
    chooseHint: 'Choose the folder that holds your notes.',
    chooseVault: 'Choose vault folder…',
    noNotes: 'No notes found in this folder.',
    openNote: 'Select a note in the graph or file tree.'
  },
  graph: {
    clusterFolder: 'Cluster by folder',
    fit: 'Fit',
    graphLabel: 'Note graph. Arrow keys move between linked notes, Enter opens the selected note.',
    local: 'Local graph (this note and its neighbours)',
    orphans: 'Show unlinked notes',
    pin: 'Pin node',
    search: 'Filter notes… (#tag)',
    stats: (notes: number, links: number) => `${notes} notes · ${links} links`,
    unpin: 'Unpin node'
  },
  note: {
    addToChat: 'Add to chat',
    backlinks: 'Linked from',
    changedOnDisk: 'Changed on disk since it was opened',
    edit: 'Edit',
    loading: 'Loading…',
    overwrite: 'Overwrite',
    preview: 'Preview',
    readOnly: 'Too large or not text — shown read-only.',
    reload: 'Reload from disk',
    saved: 'Saved',
    saving: 'Saving…',
    unsaved: 'Unsaved'
  },
  settings: {
    autosave: 'Autosave delay (ms)',
    chooseVault: 'Choose vault folder…',
    cluster: 'Cluster graph by folder',
    hiddenFolders: 'Folders to skip (comma separated)',
    labels: 'Graph labels',
    labelsAlways: 'Always',
    labelsAuto: 'When zoomed in',
    labelsNever: 'Never',
    orphans: 'Show notes with no links',
    vault: 'Vault folder'
  },
  tree: {
    changeVault: 'Change vault folder',
    collapse: 'Collapse file tree',
    deleteConfirm: 'Delete?',
    expand: 'Expand file tree',
    hideArchive: 'Hide skipped folders',
    newNote: 'New note',
    newNoteHere: 'New note here',
    rescan: 'Rescan vault',
    reveal: 'Reveal in file tree',
    showArchive: 'Show skipped folders',
    trash: 'Move to trash'
  },
  vault: {
    noteLink: (name: string) => `Open "${name}" in Vault`,
    open: 'Open Vault',
    statusbarToggle: 'Vault button',
    title: 'Vault',
    touched: 'Recently changed by something else'
  },
  preview: {
    embedMissing: (name: string) => `Embedded note not found: ${name}`,
    embedTooDeep: 'Embedded too deeply',
    imageMissing: (name: string) => `Image not found: ${name}`,
    openEmbedded: 'Open this note'
  },
  warn: {
    notFound: (name: string) => `Note not found: ${name}`,
    linksRewritten: (count: number, notes: number) => `Updated ${count} link(s) in ${notes} note(s).`,
    linksSkipped: (names: string) => `Could not update links in: ${names}`
  }
}

export type Messages = typeof en
