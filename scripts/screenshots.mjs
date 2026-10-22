// Renders the REAL plugin components against the fictional demo vault in headless Edge/Chrome and
// writes docs/screenshots/*.png. Only the host app around the plugin (SDK, theme tokens, markdown
// renderer) is simulated, so these are representative, not literal Hermes Desktop captures.
//
//   node scripts/screenshots.mjs [scene …]      scenes: graph note preview search local light
import { build } from 'esbuild'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vaultDir = join(root, 'demo', 'vault')
const outDir = join(root, 'docs', 'screenshots')
// Generated files live outside the repo so plugin validation never scans bundled React/marked.
const work = join(tmpdir(), 'plexus-harness')

const SCENES = {
  graph: 'overview',
  light: 'light',
  local: 'local-graph',
  note: 'editor',
  preview: 'preview',
  search: 'search'
}

const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync)

if (!browser) {
  console.error('No Edge or Chrome found.')
  process.exit(1)
}

// 1. The vault as JSON (notes as text, images as data URLs).
const files = {}
const images = {}

;(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)

    if (entry.isDirectory()) {
      walk(full)
      continue
    }

    const rel = full.slice(vaultDir.length + 1).split('\\').join('/')

    if (extname(rel) === '.md') {
      files[rel] = readFileSync(full, 'utf8')
    } else if (extname(rel) === '.svg') {
      images[rel] = `data:image/svg+xml;base64,${readFileSync(full).toString('base64')}`
    }
  }
})(vaultDir)

mkdirSync(work, { recursive: true })
writeFileSync(join(work, 'vault.json'), JSON.stringify({ files, images }))

// 2. Bundle the harness (React included, SDK aliased to the browser stub).
await build({
  alias: { '@hermes/plugin-sdk': join(root, 'demo', 'harness', 'sdk.tsx'), 'plexus-demo-vault': join(work, 'vault.json') },
  bundle: true,
  entryPoints: [join(root, 'demo', 'harness', 'entry.tsx')],
  format: 'iife',
  jsx: 'automatic',
  logLevel: 'warning',
  loader: { '.json': 'json' },
  outfile: join(work, 'harness.js'),
  platform: 'browser',
  target: 'es2022'
})

// 3. The page: theme tokens approximating Hermes' dark/light skins, plus the codicon font inlined.
const codicons = join(root, 'node_modules', '@vscode', 'codicons', 'dist')
const font = readFileSync(join(codicons, 'codicon.ttf')).toString('base64')

const codiconCss = readFileSync(join(codicons, 'codicon.css'), 'utf8').replace(
  /url\([^)]*codicon\.ttf[^)]*\)/,
  `url(data:font/ttf;base64,${font})`
)

const theme = `
:root[data-theme="dark"] { --bg: #1b1d23; --ui-text-primary: #e6e8ee; --ui-text-secondary: #b4b9c6; --ui-text-tertiary: #7f8595;
  --ui-stroke-secondary: rgba(255,255,255,.12); --ui-accent: #6ea8fe; color-scheme: dark; }
:root[data-theme="light"] { --bg: #fafafa; --ui-text-primary: #1b1f27; --ui-text-secondary: #3d4452; --ui-text-tertiary: #7b8494;
  --ui-stroke-secondary: rgba(0,0,0,.14); --ui-accent: #2f6fed; color-scheme: light; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--ui-text-secondary); font-family: "Segoe UI", system-ui, sans-serif; }
`

writeFileSync(
  join(work, 'harness.html'),
  `<!doctype html><html><head><meta charset="utf-8"><title>harness</title><style>${codiconCss}${theme}</style></head>` +
    `<body><div id="root"></div><script src="harness.js"></script></body></html>`
)

// 4. One capture per scene, driven over the DevTools protocol in real time: the harness sets
// document.title to "ready" once the layout has settled, then we take the screenshot. (The CLI's
// --screenshot with a virtual-time budget occasionally caught the canvas mid-resize, i.e. blank.)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const WIDTH = 1400
const HEIGHT = 880

async function capture(scene, file) {
  const profile = mkdtempSync(join(tmpdir(), 'plexus-shot-'))

  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  try {
    const portFile = join(profile, 'DevToolsActivePort')

    // The browser writes this file as it starts; it can be briefly locked or half-written.
    let port = ''

    for (let i = 0; i < 150 && !port; i++) {
      await sleep(100)

      try {
        port = readFileSync(portFile, 'utf8').trim().split(/\r?\n/)[0] ?? ''
      } catch {
        port = ''
      }
    }
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)

    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })

    let nextId = 0
    const pending = new Map()

    ws.onmessage = event => {
      const message = JSON.parse(event.data)

      pending.get(message.id)?.(message)
    }

    const send = (method, params = {}) =>
      new Promise(resolve => {
        const id = ++nextId

        pending.set(id, resolve)
        ws.send(JSON.stringify({ id, method, params }))
      })

    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1.5, height: HEIGHT, mobile: false, width: WIDTH })
    await send('Page.navigate', { url: `${pathToFileURL(join(work, 'harness.html')).href}#scene=${scene}` })

    let ready = false

    for (let i = 0; i < 120 && !ready; i++) {
      await sleep(250)
      ready = (await send('Runtime.evaluate', { expression: 'document.title' })).result?.result?.value === 'ready'
    }

    await sleep(400)

    if (process.env.PLEXUS_EVAL) {
      // Debugging aid: print an expression evaluated in the settled page, e.g. PLEXUS_EVAL="document.title".
      const evaluated = await send('Runtime.evaluate', { expression: process.env.PLEXUS_EVAL, returnByValue: true })

      console.log(JSON.stringify(evaluated.result?.result?.value ?? evaluated.result))
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' })

    writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
    ws.close()

    return ready
  } finally {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    await sleep(300)
    rmSync(profile, { force: true, recursive: true, maxRetries: 3 })
  }
}

mkdirSync(outDir, { recursive: true })

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES)

for (const scene of wanted) {
  const file = join(outDir, `${SCENES[scene]}.png`)
  const ready = await capture(scene, file)

  console.log(`${scene}: ${file}${ready ? '' : '  (page never reported ready)'}`)
}
