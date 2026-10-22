/**
 * The slice of Hermes Desktop's Electron file bridge (`window.hermesDesktop`) this plugin uses.
 * Everything runs on the machine hosting the desktop app: no backend, REST route or network.
 */

export interface DirEntry {
  isDirectory: boolean
  name: string
  path: string
}

export interface ReadFileResult {
  binary?: boolean
  path: string
  text: string
  truncated?: boolean
}

export interface ReadFileError {
  error: string
  message: string
  ok: false
  path?: string
}

export interface Bridge {
  readDir: (path: string) => Promise<{ entries: DirEntry[]; error?: string }>
  readFileDataUrl?: (path: string) => Promise<ReadFileError | string>
  readFileText: (path: string) => Promise<ReadFileError | ReadFileResult>
  renamePath?: (path: string, newName: string) => Promise<{ path: string }>
  selectPaths?: (options?: { defaultPath?: string; directories?: boolean; title?: string }) => Promise<string[]>
  trashPath?: (path: string) => Promise<boolean>
  writeTextFile?: (path: string, content: string) => Promise<{ path: string }>
}

export function getBridge(): Bridge | undefined {
  return (window as unknown as { hermesDesktop?: Bridge }).hermesDesktop
}
