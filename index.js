/**
 * Host half of the GitHub workspace bundle.
 *
 * Owns one same-origin HTTP route under the Web GUI origin that:
 *   - `defaults` answers the suggested clone parent directory;
 *   - `clone` parses a GitHub repository reference (URL or `owner/repo`),
 *     clones it with `git clone` into `<parent>/<repo>`, then registers that
 *     directory through `ctx.workspaceRegistry.create()`, which publishes the
 *     new Workspace to every connected browser through the Workspace feed.
 *
 * Requests must pass the Connection trust fence; bodies are bounded and every
 * failure answers a stable `code` the browser half localizes.
 */

import { execFile } from 'node:child_process'
import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Route namespace shared with `client.js`. */
const API_PREFIX = '/dsh-github-workspace/api'
/** Upper bound for one JSON request body. */
const MAX_BODY_BYTES = 64 * 1024
/** Root the default clone parent is derived from. */
const DEFAULT_PARENT_SEGMENT = 'deepseek-harness'

/** Host services this plugin needs before it activates. */
export const inject = ['webServer', 'connection', 'workspaceRegistry']

/**
 * One failure with a stable code and HTTP status.
 */
class ApiError extends Error {
  /**
   * @param code - stable machine code the browser half localizes.
   * @param message - human-readable diagnostic (English, shown as detail).
   * @param status - HTTP status for the answer.
   */
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/**
 * Mount the route while this plugin is active.
 * @param ctx - Host Cordis context carrying the injected services.
 * @param config - bundle row configuration.
 */
export function apply(ctx, config) {
  const settings = resolveSettings(config ?? {})
  const state = {
    /** Cached default clone parent. */
    defaultParent: undefined,
    /** Cached Documents directory probe. */
    documents: undefined,
    /** Clone targets currently being written, lowercased. */
    inflight: new Set(),
    /** Cached GitHub CLI token probe: `{ at, value }`. */
    ghToken: undefined,
    /** Last parent folder a clone succeeded into; `undefined` until read. */
    lastParent: undefined,
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (req, res) => {
      handle(ctx, settings, state, req, res).catch((error) => {
        // The handler already answers its own failures; this is the last
        // resort for a throw outside the request pipeline.
        try {
          send(res, 500, failure(new ApiError('internal', reasonOf(error), 500)))
        } catch {
          // The response is already gone.
        }
      })
    },
  }), 'github-workspace: same-origin clone API')
}

/**
 * Normalize the row config with defaults.
 * @param config - raw bundle row config.
 * @returns resolved settings.
 */
function resolveSettings(config) {
  const cloneRoot = typeof config.cloneRoot === 'string' ? config.cloneRoot.trim() : ''
  const gitCommand = typeof config.gitCommand === 'string' && config.gitCommand.trim() !== ''
    ? config.gitCommand.trim()
    : 'git'
  const ghCommand = typeof config.ghCommand === 'string' && config.ghCommand.trim() !== ''
    ? config.ghCommand.trim()
    : 'gh'
  const auth = config.auth === 'none' ? 'none' : 'auto'
  const timeoutMs = Number.isSafeInteger(config.timeoutMs) && config.timeoutMs > 0
    ? config.timeoutMs
    : 10 * 60 * 1000
  return { cloneRoot, gitCommand, ghCommand, auth, timeoutMs }
}

/**
 * Answer one POST request.
 * @param ctx - Host context.
 * @param settings - resolved plugin settings.
 * @param state - per-mount caches and locks.
 * @param req - Node request.
 * @param res - Node response.
 */
async function handle(ctx, settings, state, req, res) {
  let rejection
  try {
    rejection = ctx.connection.requestRejection(req)
  } catch (error) {
    rejection = reasonOf(error)
  }
  if (rejection !== undefined) {
    send(res, 403, failure(new ApiError('forbidden', 'forbidden', 403)))
    return
  }
  if (req.method !== 'POST') {
    send(res, 405, failure(new ApiError('method', 'method not allowed', 405)))
    return
  }

  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const method = url.pathname.startsWith(API_PREFIX)
    ? url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '').replace(/\/+$/, '')
    : ''

  try {
    if (method === 'defaults') {
      send(res, 200, { ok: true, value: await defaultsValue(settings, state) })
      return
    }
    if (method === 'clone') {
      const payload = parseBody(await readBody(req))
      send(res, 200, { ok: true, value: await cloneAndRegister(ctx, settings, state, payload, res) })
      return
    }
    throw new ApiError('not-found', `unknown method "${method}"`, 404)
  } catch (error) {
    const failureError = error instanceof ApiError ? error : new ApiError('internal', reasonOf(error), 500)
    send(res, failureError.status, failure(failureError))
  }
}

/**
 * Build the answer for `defaults`.
 * @param settings - resolved plugin settings.
 * @param state - per-mount caches.
 * @returns default parent, path separator, and home directory.
 */
async function defaultsValue(settings, state) {
  const defaultParent = await defaultParentOf(settings, state)
  const token = await resolveGitHubToken(settings, state)
  return {
    defaultParent,
    /** Parent folder of the most recent successful clone, when one was recorded. */
    lastParent: await readLastParent(state),
    separator: path.sep,
    home: homedir(),
    platform: process.platform,
    /** Which credential source a private repository will use. */
    auth: token === undefined ? 'none' : 'gh',
  }
}

/**
 * Location of the remembered parent folder: durable for the Host account and
 * shared by every browser, rather than per-browser storage.
 * @returns absolute JSON file path.
 */
function lastParentFile() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : path.join(homedir(), '.dsh')
  return path.join(home, 'data', 'dsh-github-workspace', 'last-parent.json')
}

/**
 * Read the remembered parent folder once per mount.
 * @param state - per-mount caches.
 * @returns the remembered absolute path, or null.
 */
async function readLastParent(state) {
  if (state.lastParent !== undefined) return state.lastParent
  try {
    const parsed = JSON.parse(await readFile(lastParentFile(), 'utf8'))
    state.lastParent = typeof parsed?.parent === 'string' && path.isAbsolute(parsed.parent) ? parsed.parent : null
  } catch {
    state.lastParent = null
  }
  return state.lastParent
}

/**
 * Record the parent folder of a successful clone. Best effort: a write failure
 * never fails the clone the user just got.
 * @param state - per-mount caches.
 * @param parent - absolute parent directory that received the checkout.
 * @returns nothing.
 */
async function writeLastParent(state, parent) {
  state.lastParent = parent
  try {
    await mkdir(path.dirname(lastParentFile()), { recursive: true })
    await writeFile(lastParentFile(), `${JSON.stringify({ parent, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  } catch {
    // Remembering the folder is a convenience; the clone already succeeded.
  }
}

/**
 * Read a GitHub token from the signed-in GitHub CLI, cached briefly.
 *
 * The token is never logged and never placed in a command line: it reaches git
 * only as an environment value for one clone. A missing CLI or a signed-out
 * account yields undefined, leaving the public-repository path unchanged.
 * @param settings - resolved plugin settings.
 * @param state - per-mount caches.
 * @returns the token, or undefined when no GitHub CLI session is usable.
 */
async function resolveGitHubToken(settings, state) {
  if (settings.auth === 'none') return undefined
  const now = Date.now()
  if (state.ghToken !== undefined && now - state.ghToken.at < 5 * 60 * 1000) {
    return state.ghToken.value
  }
  const candidates = [settings.ghCommand]
  if (process.platform === 'win32' && typeof process.env.ProgramFiles === 'string') {
    candidates.push(path.join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe'))
  }
  let value
  for (const candidate of candidates) {
    try {
      const stdout = await capture(candidate, ['auth', 'token', '--hostname', 'github.com'], 15_000)
      const token = stdout.trim()
      if (token !== '') {
        value = token
        break
      }
    } catch {
      // Try the next candidate; an absent CLI simply has no token.
    }
  }
  state.ghToken = { at: now, value }
  return value
}

/**
 * Run one command and resolve its standard output.
 * @param command - executable.
 * @param args - arguments.
 * @param timeoutMs - deadline.
 * @returns captured standard output.
 */
function capture(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    try {
      execFile(command, args, {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        env: gitEnvironment(),
      }, (error, stdout, stderr) => {
        if (error === null || error === undefined) resolve(String(stdout ?? ''))
        else reject(new Error(String(stderr || error.message)))
      })
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * Resolve (and cache) the suggested clone parent.
 * @param settings - resolved plugin settings.
 * @param state - per-mount caches.
 * @returns absolute parent directory.
 */
async function defaultParentOf(settings, state) {
  if (settings.cloneRoot !== '') return validateParent(settings.cloneRoot)
  if (state.defaultParent === undefined) {
    state.defaultParent = (async () => {
      if (state.documents === undefined) state.documents = documentsDirectory()
      const documents = await state.documents
      return path.join(documents, DEFAULT_PARENT_SEGMENT)
    })()
  }
  return state.defaultParent
}

/**
 * Resolve the Host account's Documents directory.
 * @returns absolute Documents directory.
 */
function documentsDirectory() {
  if (process.platform !== 'win32') return Promise.resolve(path.join(homedir(), 'Documents'))
  return new Promise((resolve) => {
    const script = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '
      + '[Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments, '
      + '[Environment+SpecialFolderOption]::DoNotVerify)'
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 15_000,
      env: gitEnvironment(),
    }, (error, stdout) => {
      const value = error === null && typeof stdout === 'string' ? stdout.trim() : ''
      resolve(value !== '' && path.win32.isAbsolute(value) ? value : path.join(homedir(), 'Documents'))
    })
  })
}

/**
 * Clone the requested repository and register the checkout as a Workspace.
 * @param ctx - Host context.
 * @param settings - resolved plugin settings.
 * @param state - per-mount caches and locks.
 * @param payload - parsed `{ repo, parent }` request body.
 * @param res - Node response, used to observe client disconnects.
 * @returns the registered Workspace projection plus the clone facts.
 */
async function cloneAndRegister(ctx, settings, state, payload, res) {
  const repo = parseRepository(payload.repo)
  const shallow = payload.shallow === true
  const parentInput = typeof payload.parent === 'string' ? payload.parent.trim() : ''
  const parent = validateParent(parentInput === '' ? await defaultParentOf(settings, state) : parentInput)
  const target = path.join(parent, repo.name)
  assertContained(parent, target)

  const lockKey = process.platform === 'win32' ? target.toLowerCase() : target
  if (state.inflight.has(lockKey)) {
    throw new ApiError('busy', `another clone is already writing ${target}`, 409)
  }
  state.inflight.add(lockKey)
  const abort = new AbortController()
  const onClose = () => { abort.abort() }
  res?.once?.('close', onClose)
  if (res?.writableEnded === true) abort.abort()

  let created = false
  try {
    await ensureParent(parent)
    created = await prepareTarget(target)
    // A GitHub CLI session authenticates HTTPS clones without touching the
    // user's git configuration; SSH references keep using the SSH agent.
    const token = repo.transport === 'https' ? await resolveGitHubToken(settings, state) : undefined
    const args = ['clone', ...(shallow ? ['--depth', '1'] : []), '--', repo.cloneUrl, target]
    await runGit(settings, args, abort.signal, { token, ssh: repo.transport === 'ssh' })
    const gitDirectory = await stat(path.join(target, '.git')).catch(() => undefined)
    if (gitDirectory === undefined || !gitDirectory.isDirectory()) {
      throw new ApiError('clone-failed', 'git finished without creating a .git directory', 502)
    }
    let workspace
    try {
      workspace = await ctx.workspaceRegistry.create(target)
    } catch (error) {
      throw new ApiError('workspace-failed', reasonOf(error), 500)
    }
    await writeLastParent(state, parent)
    return {
      workspace: {
        workspaceId: String(workspace.id),
        path: workspace.path,
        title: workspace.title,
      },
      repo: { host: repo.host, owner: repo.owner, name: repo.name, cloneUrl: repo.cloneUrl },
      shallow,
      target,
    }
  } catch (error) {
    if (created) await rm(target, { recursive: true, force: true }).catch(() => {})
    throw error
  } finally {
    res?.off?.('close', onClose)
    state.inflight.delete(lockKey)
  }
}

/**
 * Create the parent directory when it is missing.
 * @param parent - absolute parent directory.
 */
async function ensureParent(parent) {
  try {
    await mkdir(parent, { recursive: true })
  } catch (error) {
    throw new ApiError('parent-unavailable', `cannot create ${parent}: ${reasonOf(error)}`, 400)
  }
  const info = await stat(parent).catch(() => undefined)
  if (info === undefined || !info.isDirectory()) {
    throw new ApiError('parent-unavailable', `${parent} is not a directory`, 400)
  }
}

/**
 * Decide whether the checkout directory can be written.
 * @param target - absolute checkout directory.
 * @returns true when this request created the directory and owns its cleanup.
 */
async function prepareTarget(target) {
  const existing = await lstat(target).catch(() => undefined)
  if (existing === undefined) return true
  if (!existing.isDirectory()) {
    throw new ApiError('target-exists', `${target} already exists and is not a directory`, 409)
  }
  const entries = await readdir(target).catch(() => [])
  if (entries.length > 0) {
    throw new ApiError('target-exists', `${target} already exists and is not empty`, 409)
  }
  return false
}

/**
 * Run one git command under the plugin's deadline and abort signal.
 * @param settings - resolved plugin settings.
 * @param args - git arguments.
 * @param signal - client disconnect and plugin shutdown.
 * @param auth - `{ token, ssh }`: GitHub CLI token for an HTTPS clone and
 * whether the remote is addressed over SSH.
 * @returns nothing; rejects with an {@link ApiError}.
 */
function runGit(settings, args, signal, auth = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = execFile(settings.gitCommand, args, {
        windowsHide: true,
        timeout: settings.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: cloneEnvironment(auth),
        signal,
      }, (error, stdout, stderr) => {
        if (error === null || error === undefined) {
          resolve()
          return
        }
        if (signal?.aborted === true || error.name === 'AbortError') {
          reject(new ApiError('cancelled', 'the clone was cancelled', 499))
          return
        }
        if (error.code === 'ENOENT') {
          reject(new ApiError('git-missing', `git was not found (${settings.gitCommand})`, 500))
          return
        }
        if (error.killed === true || (error.signal !== undefined && error.signal !== null)) {
          reject(new ApiError('timeout', `git clone exceeded ${settings.timeoutMs} ms`, 504))
          return
        }
        reject(classifyCloneFailure(stderr, error, auth.ssh === true))
      })
    } catch (error) {
      // A synchronous spawn failure (blocked executable, bad cwd) never
      // reaches the callback above.
      reject(new ApiError('git-missing', `cannot start ${settings.gitCommand}: ${reasonOf(error)}`, 500))
      return
    }
    child.on?.('error', () => {})
  })
}

/**
 * Build the git environment for one clone.
 *
 * With a token, the Basic authorization header carries it through git's own
 * environment-config mechanism (`GIT_CONFIG_*`), so it never appears on a
 * command line, never lands in `.git/config`, and needs no credential-helper
 * process. Inherited helpers are cleared for that invocation, so git cannot
 * open an interactive prompt. Without a token, the user's own credential
 * helpers and SSH agent apply as before.
 * @param auth - `{ token }`.
 * @returns the child environment.
 */
function cloneEnvironment(auth) {
  const env = gitEnvironment()
  if (typeof auth.token !== 'string' || auth.token === '') return env
  const basic = Buffer.from(`x-access-token:${auth.token}`, 'utf8').toString('base64')
  env.GIT_CONFIG_COUNT = '2'
  env.GIT_CONFIG_KEY_0 = 'credential.helper'
  env.GIT_CONFIG_VALUE_0 = ''
  env.GIT_CONFIG_KEY_1 = 'http.https://github.com/.extraheader'
  env.GIT_CONFIG_VALUE_1 = `AUTHORIZATION: basic ${basic}`
  return env
}

/**
 * Map one failed git invocation to a stable API failure.
 * @param stderr - captured standard error.
 * @param error - the execFile error.
 * @param ssh - whether the remote was addressed over SSH.
 * @returns the failure to report.
 */
function classifyCloneFailure(stderr, error, ssh) {
  const text = `${stderr ?? ''}\n${error?.message ?? ''}`
  if (/could not read Username|terminal prompts disabled|Authentication failed|invalid username or password|Support for password authentication|Permission denied \(publickey\)|Host key verification failed|Could not read from remote repository/i.test(text)) {
    return new ApiError('auth-required', ssh
      ? 'the SSH key or agent could not authenticate to github.com'
      : 'no GitHub credential could authenticate this repository', 502)
  }
  if (/Repository not found|does not appear to be a git repository|not found/i.test(text)) {
    return new ApiError('repo-not-found', summarizeGitError(stderr, error), 404)
  }
  return new ApiError('clone-failed', summarizeGitError(stderr, error), 502)
}

/**
 * Condense git diagnostics into one short line.
 * @param stderr - captured standard error.
 * @param error - the execFile error.
 * @returns readable detail.
 */
function summarizeGitError(stderr, error) {
  const text = typeof stderr === 'string' && stderr.trim() !== '' ? stderr : String(error?.message ?? 'git clone failed')
  const lines = text.split(/\r?\n|(?<=\r)/)
    .map(line => line.trim())
    .filter(line => line !== '' && !/^Receiving objects:|^Resolving deltas:|^remote: (Counting|Compressing|Enumerating|Total)/.test(line))
  const tail = lines.slice(-6).join(' · ')
  return (tail === '' ? text.trim() : tail).slice(0, 600)
}

/**
 * Parse a GitHub repository reference.
 * @param input - URL, scp-style remote, `github.com/owner/repo`, or `owner/repo`.
 * @returns host, owner, name, and the URL git will clone.
 */
function parseRepository(input) {
  if (typeof input !== 'string') throw new ApiError('invalid-repo', 'repository is required')
  const value = input.trim().replace(/^[<\[("'`\s]+/, '').replace(/[>\]")'`\s]+$/, '')
  if (value === '') throw new ApiError('invalid-repo', 'repository is required')

  let host
  let segments = []
  // How git should address the remote: HTTPS or SSH; `git://` keeps its URL.
  let transport = 'https'

  const urlMatch = /^(https?|ssh|git):\/\/[^\s]+$/i.exec(value)
  if (urlMatch !== null) {
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      throw new ApiError('invalid-repo', `not a valid URL: ${value}`)
    }
    host = parsed.hostname.toLowerCase()
    segments = parsed.pathname.split('/').filter(segment => segment !== '')
    const scheme = urlMatch[1].toLowerCase()
    transport = scheme === 'ssh' ? 'ssh' : scheme === 'git' ? 'git' : 'https'
  } else {
    const scpMatch = /^(?:[A-Za-z0-9._-]+@)([A-Za-z0-9.-]+):([^\s]+)$/.exec(value)
    if (scpMatch !== null) {
      host = scpMatch[1].toLowerCase()
      segments = scpMatch[2].split('/').filter(segment => segment !== '')
      transport = 'ssh'
    } else {
      const hostPathMatch = /^([A-Za-z0-9.-]+\.[A-Za-z]{2,})\/([^\s]+)$/.exec(value)
      if (hostPathMatch !== null) {
        host = hostPathMatch[1].toLowerCase()
        segments = hostPathMatch[2].split('/').filter(segment => segment !== '')
      } else {
        const bareMatch = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(value)
        if (bareMatch === null) {
          throw new ApiError('invalid-repo', 'use owner/repo or a github.com repository URL')
        }
        host = 'github.com'
        segments = [bareMatch[1], bareMatch[2]]
      }
    }
  }

  if (host !== 'github.com' && host !== 'www.github.com') {
    throw new ApiError('invalid-repo', `unsupported host "${host}"; only github.com is supported`)
  }
  if (segments.length < 2) {
    throw new ApiError('invalid-repo', 'the reference must name an owner and a repository')
  }
  const owner = segments[0]
  const name = segments[1].replace(/\.git$/i, '')
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) {
    throw new ApiError('invalid-repo', `invalid GitHub owner "${owner}"`)
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') {
    throw new ApiError('invalid-repo', `invalid GitHub repository name "${name}"`)
  }
  const cloneUrl = transport === 'ssh'
    ? `git@github.com:${owner}/${name}.git`
    : transport === 'git'
      ? `git://github.com/${owner}/${name}.git`
      : `https://github.com/${owner}/${name}.git`
  return { host: 'github.com', owner, name, cloneUrl, transport }
}

/**
 * Validate and normalize a fully qualified parent directory.
 * @param input - user-entered path.
 * @returns normalized absolute path.
 */
function validateParent(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new ApiError('invalid-path', 'a destination directory is required')
  }
  let value = input.trim().replace(/^["']|["']$/g, '')
  if (value === '~') value = homedir()
  else if (value.startsWith('~/') || value.startsWith('~\\')) value = path.join(homedir(), value.slice(2))
  if (value.includes('\0')) throw new ApiError('invalid-path', 'the destination contains a null byte')
  const paths = process.platform === 'win32' ? path.win32 : path.posix
  if (!paths.isAbsolute(value)) {
    throw new ApiError('invalid-path', `the destination must be an absolute path: ${value}`)
  }
  const normalized = paths.normalize(value)
  if (process.platform === 'win32' && /^[A-Za-z]:\\?$/.test(normalized)) return normalized
  return normalized.replace(/[\\/]+$/, '') || normalized
}

/**
 * Refuse a checkout directory outside the chosen parent.
 * @param parent - absolute parent directory.
 * @param target - absolute checkout directory.
 */
function assertContained(parent, target) {
  const relative = path.relative(parent, target)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ApiError('invalid-path', 'the checkout directory escapes the chosen parent')
  }
}

/**
 * Environment for git: inherited minus DSH and secret-bearing variables, with
 * prompting disabled so a private repository without credentials fails fast
 * instead of hanging on a prompt.
 * @returns scrubbed environment.
 */
function gitEnvironment() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('DSH_')) continue
    if (/(KEY|PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL)/i.test(key)) continue
    env[key] = value
  }
  env.GIT_TERMINAL_PROMPT = '0'
  env.GCM_INTERACTIVE = 'Never'
  return env
}

/**
 * Read and parse a bounded JSON body.
 * @param req - Node request.
 * @returns parsed object (empty object for an empty body).
 */
async function readBody(req) {
  const chunks = []
  let size = 0
  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError('bad-request', 'request body is too large', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', resolve)
    req.on('error', reject)
  })
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Parse the request JSON body.
 * @param text - raw body.
 * @returns parsed object.
 */
function parseBody(text) {
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('the body must be a JSON object')
    }
    return parsed
  } catch (error) {
    throw new ApiError('bad-request', `invalid JSON body: ${reasonOf(error)}`, 400)
  }
}

/**
 * Build the failure envelope.
 * @param error - one API failure.
 * @returns response payload.
 */
function failure(error) {
  return { ok: false, error: { code: error.code, message: error.message } }
}

/**
 * Write one JSON answer.
 * @param res - Node response.
 * @param status - HTTP status.
 * @param payload - JSON payload.
 */
function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Read a readable message from an unknown thrown value.
 * @param error - thrown value.
 * @returns message text.
 */
function reasonOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
