// Measurements for the nested layout.
//   node scripts/bench.mjs           simulation, projection and geometry cost, and boundary crowding (Node)
//   node scripts/bench.mjs paint     canvas paint cost of the real GraphView in headless Edge/Chrome
// Paint numbers come from a stand-in for the Hermes webview (see the README of the harness in screenshots.mjs).
import { build } from 'esbuild'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'plexus-bench-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function node() {
  const outfile = join(dir, 'bench.mjs')

  await build({ bundle: true, entryPoints: ['demo/bench.ts'], format: 'esm', logLevel: 'warning', outfile, platform: 'node' })
  await import(pathToFileURL(outfile).href)
}

async function paint() {
  const browser = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
  ].find(existsSync)

  if (!browser) {
    throw new Error('No Edge or Chrome found.')
  }

  await build({
    alias: { '@hermes/plugin-sdk': join(process.cwd(), 'demo', 'harness', 'sdk.tsx') },
    bundle: true,
    entryPoints: ['demo/harness/bench-entry.tsx'],
    format: 'iife',
    jsx: 'automatic',
    logLevel: 'warning',
    outfile: join(dir, 'bench.js'),
    platform: 'browser',
    target: 'es2022'
  })
  writeFileSync(join(dir, 'bench.html'), '<!doctype html><html><body style="margin:0"><div id="root"></div><script src="bench.js"></script></body></html>')

  const cases = [
    ['folder', 'n=1000&cluster=folder'],
    ['nested', 'n=1000&cluster=nested'],
    ['folder', 'n=3000&cluster=folder'],
    ['nested', 'n=3000&cluster=nested&depth=4'],
    ['nested folder-per-note', 'n=1000&cluster=nested&per=1&depth=3']
  ]

  for (const [label, query] of cases) {
    const profile = mkdtempSync(join(tmpdir(), 'plexus-bench-profile-'))
    const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1400,880', 'about:blank'], { stdio: 'ignore' })

    try {
      let port = ''

      for (let i = 0; i < 150 && !port; i++) {
        await sleep(100)

        try {
          port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/)[0] ?? ''
        } catch {
          port = ''
        }
      }

      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)

      await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)))

      let id = 0
      const pending = new Map()

      ws.onmessage = event => pending.get(JSON.parse(event.data).id)?.(JSON.parse(event.data))

      const send = (method, params = {}) => new Promise(resolve => ((pending.set(++id, resolve), ws.send(JSON.stringify({ id, method, params })))))

      await send('Page.enable')
      await send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: 880, mobile: false, width: 1400 })
      await send('Page.navigate', { url: `${pathToFileURL(join(dir, 'bench.html')).href}#${query}` })

      let done = false

      for (let i = 0; i < 400 && !done; i++) {
        await sleep(250)
        done = (await send('Runtime.evaluate', { expression: 'document.title' })).result?.result?.value === 'done'
      }

      const result = (await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__result)', returnByValue: true })).result?.result?.value
      const r = result ? JSON.parse(result) : null

      console.log(
        r
          ? `${label.padEnd(24)} N=${r.notes}: settle ${(r.settleMs / 1000).toFixed(1)}s (${r.frames} frames)${r.settled ? '' : ' (not settled)'}; paint during settle median ${r.during.median.toFixed(2)}ms p95 ${r.during.p95.toFixed(2)}ms (${r.during.count}); paint while zooming median ${r.zooming.median.toFixed(2)}ms p95 ${r.zooming.p95.toFixed(2)}ms (${r.zooming.count})`
          : `${label}: no result`
      )
      ws.close()
    } finally {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      await sleep(300)
      rmSync(profile, { force: true, recursive: true, maxRetries: 3 })
    }
  }
}

try {
  mkdirSync(dir, { recursive: true })
  await (process.argv[2] === 'paint' ? paint() : node())
} finally {
  rmSync(dir, { force: true, recursive: true })
}
