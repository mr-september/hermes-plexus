// Copies desktop/plugin.js into <HERMES_HOME>/desktop-plugins/hermes-plexus/ — the disk
// door Hermes Desktop watches and hot-reloads. The folder name must equal the plugin id.
import { copyFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const home = process.env.HERMES_HOME || (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'hermes') : join(homedir(), '.hermes'))
const dir = join(home, 'desktop-plugins', 'hermes-plexus')

mkdirSync(dir, { recursive: true })
copyFileSync('desktop/plugin.js', join(dir, 'plugin.js'))
console.log(`Deployed to ${join(dir, 'plugin.js')}`)
