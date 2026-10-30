/**
 * UI strings. Registered through the SDK's plugin i18n (`ctx.i18n.register`) so Hermes can
 * resolve them against the user's language; any locale without a bundle falls back to English.
 * Add a language by adding a sibling object here — keys must match `en`.
 */

export const PLUGIN_ID = 'hermes-plexus'

export const en = {
  common: { close: 'Close', rename: 'Rename' },
  empty: {
    chooseHint: 'Choose the folder that holds your notes.',
    chooseVault: 'Choose vault folder…',
    noAccess: 'Hermes no longer has access to this vault folder. Choose it again to grant access.',
    noNotes: 'No notes found in this folder.',
    openNote: 'Select a note in the graph or file tree.'
  },
  graph: {
    clusterFolder: 'Cluster by folder',
    clusterNested: 'Nested folder regions (notes stay inside their folder)',
    fit: 'Fit',
    graphLabel: 'Note graph. Arrow keys move between linked notes, Enter opens the selected note.',
    local: 'Local graph (this note and its neighbours)',
    nestedHelp:
      "Folders are nested regions and notes stay inside their own folder's region, so a note cannot be dragged out of it. Click a region's label to zoom to that folder; click a step of the path or press Escape to go back out.",
    pathLabel: 'Folder path',
    pathRoot: 'Vault',
    orphans: 'Show unlinked notes',
    search: 'Filter notes… (#tag)',
    stats: (notes: number, links: number) => `${notes} notes · ${links} links`
  },
  note: {
    addToChat: 'Add to chat',
    backlinks: 'Linked from',
    changedOnDisk: 'Changed on disk since it was opened',
    edit: 'Edit',
    loading: 'Loading…',
    openNotes: 'Open notes',
    overwrite: 'Overwrite',
    preview: 'Preview',
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
    remoteImages: 'Load images linked from the web in Preview (the image host can see your IP address)',
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
    showArchive: 'Show skipped folders',
    trash: 'Move to trash'
  },
  vault: {
    noteLink: (name: string) => `Open "${name}" in Vault`,
    open: 'Open Vault',
    statusbarToggle: 'Vault button',
    title: 'Vault'
  },
  preview: {
    embedMissing: (name: string) => `Embedded note not found: ${name}`,
    embedTooDeep: 'Embedded too deeply',
    imageMissing: (name: string) => `Image not found: ${name}`,
    openEmbedded: 'Open this note',
    remoteBlocked: (alt: string, host: string) => `${alt ? `${alt} · ` : ''}Image from ${host} not loaded`,
    remoteLoad: 'Load remote images',
    remoteWhy: 'Loading an image from the web tells its host your IP address and when you opened this note. You can turn this off again in Settings → Plugins → Vault.'
  },
  warn: {
    depth: (path: string) =>
      `Some folders were skipped: nesting deeper than 32 levels near "${path || '/'}" (possible symlink loop). Notes inside are not shown.`,
    dismiss: 'Dismiss',
    folders: (path: string) =>
      `Stopped after 10,000 folders near "${path || '/'}" (possible symlink loop). Some notes are not shown.`,
    truncated: (path: string) => `"${path || '/'}" has more entries than Hermes can list, so some notes are not shown.`,
    notFound: (name: string) => `Note not found: ${name}`,
    linksRewritten: (count: number, notes: number) => `Updated ${count} link(s) in ${notes} note(s).`,
    linksSkipped: (names: string) => `Could not update links in: ${names}`
  }
}

export type Messages = typeof en
