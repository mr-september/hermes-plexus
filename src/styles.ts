/**
 * The plugin's stylesheet. Disk plugins are not part of the app's build, so utility classes
 * are not guaranteed to exist — the plugin brings its own, namespaced `vc-` and driven by the
 * app's theme variables so it reskins with every theme.
 */

export const STYLE_ID = 'vault-constellation-styles'

export const CSS = `
.vc-root {
  --vc-text: var(--ui-text-secondary, currentColor);
  --vc-strong: var(--ui-text-primary, var(--ui-text-secondary, currentColor));
  --vc-dim: var(--ui-text-tertiary, rgba(128, 128, 128, 0.85));
  --vc-line: var(--ui-stroke-secondary, rgba(128, 128, 128, 0.3));
  --vc-accent: var(--ui-accent, #4a9eff);
  --vc-hover: rgba(128, 128, 128, 0.14);
  --vc-active: rgba(128, 128, 128, 0.22);
  --vc-danger: #e5484d;
  display: flex; height: 100%; width: 100%; min-height: 0; color: var(--vc-text); font-size: 0.75rem;
}
.vc-root button { all: unset; box-sizing: border-box; cursor: pointer; color: inherit; border-radius: 4px; }
.vc-root button:focus-visible, .vc-root canvas:focus-visible, .vc-root [role="separator"]:focus-visible,
.vc-root input:focus-visible { outline: 1px solid var(--vc-accent); outline-offset: -1px; }
.vc-root button:hover { background: var(--vc-hover); }
.vc-root button[disabled] { opacity: 0.4; cursor: default; }
.vc-root input[type="text"], .vc-root input[type="search"] {
  box-sizing: border-box; background: transparent; color: var(--vc-strong); font: inherit;
  border: 1px solid var(--vc-line); border-radius: 4px; padding: 1px 6px; min-width: 0;
}
.vc-icon { display: inline-flex; align-items: center; justify-content: center; padding: 2px 4px; }
.vc-danger { color: var(--vc-danger); }
.vc-dim { color: var(--vc-dim); }
.vc-accent { color: var(--vc-accent); }

.vc-tree-col { flex: none; border-right: 1px solid var(--vc-line); min-height: 0; }
.vc-tree { display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative; }
.vc-bar { display: flex; align-items: center; gap: 2px; height: 2rem; flex: none; padding: 0 6px;
  border-bottom: 1px solid var(--vc-line); }
.vc-bar-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-weight: 600; color: var(--vc-strong); }
.vc-select { all: unset; box-sizing: border-box; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  font-weight: 600; color: var(--vc-strong); cursor: pointer; }
.vc-select option { color: initial; }
.vc-tree-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px; }
.vc-row { display: flex; align-items: center; gap: 4px; height: 1.5rem; padding-right: 4px; border-radius: 4px; min-width: 0; }
.vc-row:hover { background: var(--vc-hover); }
.vc-row[data-active="true"] { background: var(--vc-active); color: var(--vc-strong); }
.vc-row[data-drop="true"] { outline: 1px dashed var(--vc-accent); }
.vc-row > button.vc-grow { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; height: 100%; }
.vc-row > button.vc-grow:hover { background: transparent; }
.vc-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-actions { display: none; gap: 2px; color: var(--vc-dim); }
.vc-row:hover .vc-actions, .vc-row:focus-within .vc-actions { display: flex; }
.vc-collapse { position: absolute; right: 4px; top: 2.25rem; color: var(--vc-dim); }
.vc-notice { flex: none; padding: 4px 8px; border-bottom: 1px solid var(--vc-line); text-align: left; width: 100%; }

.vc-main { flex: 1; min-width: 0; min-height: 0; display: grid; }
.vc-graph { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
.vc-canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
.vc-legend { position: absolute; left: 8px; top: 38px; display: flex; flex-wrap: wrap; gap: 2px 10px; max-width: 60%;
  font-size: 0.6875rem; color: var(--vc-dim); }
.vc-legend button { display: inline-flex; align-items: center; gap: 4px; padding: 0 2px; }
.vc-legend button[data-off="true"] { opacity: 0.4; text-decoration: line-through; }
.vc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.vc-toolbar { position: absolute; left: 8px; right: 8px; top: 6px; display: flex; align-items: center; gap: 6px; }
.vc-toolbar input { width: 12rem; }
.vc-toggle { padding: 1px 6px; color: var(--vc-dim); }
.vc-toggle[data-on="true"] { color: var(--vc-accent); }
.vc-footer { position: absolute; left: 8px; bottom: 6px; display: flex; align-items: center; gap: 8px; color: var(--vc-dim);
  font-size: 0.6875rem; }
.vc-split { cursor: col-resize; background: var(--vc-line); opacity: 0.6; }
.vc-split:hover, .vc-split:focus-visible { background: var(--vc-accent); opacity: 1; }

.vc-pane { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; }
.vc-tabs { display: flex; align-items: stretch; height: 2rem; flex: none; overflow-x: auto; border-bottom: 1px solid var(--vc-line); }
.vc-tab { display: flex; flex: none; align-items: center; gap: 4px; padding: 0 8px; border-right: 1px solid var(--vc-line);
  color: var(--vc-dim); }
.vc-tab[aria-selected="true"] { color: var(--vc-strong); box-shadow: inset 0 -2px 0 var(--vc-accent); }
.vc-tab > button { display: inline-flex; align-items: center; }
.vc-unsaved { width: 6px; height: 6px; border-radius: 50%; background: var(--vc-accent); }
.vc-subbar { display: flex; align-items: center; gap: 6px; height: 1.75rem; flex: none; padding: 0 8px;
  border-bottom: 1px solid var(--vc-line); color: var(--vc-dim); font-size: 0.6875rem; }
.vc-subbar .vc-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-pill { padding: 1px 6px; }
.vc-banner { display: flex; align-items: center; gap: 8px; flex: none; padding: 4px 8px; border-bottom: 1px solid var(--vc-line);
  font-size: 0.6875rem; }
.vc-body { flex: 1; min-height: 0; overflow: auto; }
.vc-preview { padding: 12px 16px; font-size: 0.875rem; line-height: 1.6; color: var(--vc-strong); }
.vc-backlinks { flex: none; max-height: 6rem; overflow-y: auto; padding: 4px 8px; border-top: 1px solid var(--vc-line);
  font-size: 0.6875rem; color: var(--vc-dim); }
.vc-backlinks button { margin-right: 8px; color: var(--vc-text); }
.vc-backlinks button:hover { text-decoration: underline; background: transparent; }
.vc-empty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  font-size: 0.875rem; }
.vc-btn { padding: 4px 12px; border: 1px solid var(--vc-line); }

.vc-editor { height: 100%; }
.vc-editor .cm-editor { height: 100%; background: transparent; color: var(--vc-strong); }
.vc-editor .cm-scroller { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.8rem; line-height: 1.55; }
.vc-editor .cm-content { padding: 10px 14px; caret-color: var(--vc-accent); }
.vc-editor .cm-focused { outline: none; }
.vc-editor .cm-selectionBackground, .vc-editor .cm-focused .cm-selectionBackground { background: rgba(74, 158, 255, 0.28) !important; }
.vc-editor .cm-wikilink { color: var(--vc-accent); cursor: text; }
.vc-editor .cm-tooltip-autocomplete { background: var(--ui-surface, Canvas); color: var(--vc-strong); border: 1px solid var(--vc-line); }
.vc-editor .cm-tooltip-autocomplete li[aria-selected] { background: var(--vc-active); color: var(--vc-strong); }
.vc-settings { display: flex; flex-direction: column; gap: 12px; padding: 12px; font-size: 0.8125rem; max-width: 34rem; }
.vc-settings label { display: flex; align-items: center; gap: 8px; }
.vc-settings label > span:first-child { min-width: 14rem; }
.vc-settings select { font: inherit; background: transparent; color: var(--vc-strong); border: 1px solid var(--vc-line);
  border-radius: 4px; padding: 1px 4px; }
.vc-settings input[type="text"], .vc-settings input[type="number"] { flex: 1; font: inherit; background: transparent;
  color: var(--vc-strong); border: 1px solid var(--vc-line); border-radius: 4px; padding: 2px 6px; }
`

/** Install (once) the stylesheet; returns a disposer. */
export function installStyles(): () => void {
  if (document.getElementById(STYLE_ID)) {
    return () => undefined
  }

  const style = document.createElement('style')

  style.id = STYLE_ID
  style.textContent = CSS + MD_CSS
  document.head.appendChild(style)

  return () => style.remove()
}

export const MD_CSS = `
.vc-editor .cm-md-h { color: var(--vc-strong); font-weight: 700; }
.vc-editor .cm-md-h1 { font-size: 1.35em; } .vc-editor .cm-md-h2 { font-size: 1.2em; } .vc-editor .cm-md-h3 { font-size: 1.1em; }
.vc-editor .cm-md-bold { font-weight: 700; color: var(--vc-strong); }
.vc-editor .cm-md-italic { font-style: italic; }
.vc-editor .cm-md-strike { text-decoration: line-through; opacity: 0.7; }
.vc-editor .cm-md-code { background: rgba(128, 128, 128, 0.18); border-radius: 3px; }
.vc-editor .cm-md-codeblock { background: rgba(128, 128, 128, 0.1); }
.vc-editor .cm-md-link { color: var(--vc-accent); }
.vc-editor .cm-md-tag { color: var(--vc-accent); opacity: 0.85; }
.vc-editor .cm-md-quote { color: var(--vc-dim); border-left: 2px solid var(--vc-line); }
.vc-editor .cm-md-list { color: var(--vc-accent); }
.vc-editor .cm-md-fm { color: var(--vc-dim); }
`
