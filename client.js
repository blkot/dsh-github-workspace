window.__ModuleLoader__.load({
  id: 'dsh-github-workspace',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'github-workspace'
    /** Host route shared with `index.js`. */
    const API_BASE = 'dsh-github-workspace/api'

    const en = {
      'action.label': 'Clone from GitHub',
      'dialog.title': 'Clone a GitHub repository',
      'dialog.subtitle': 'Paste a repository URL or owner/repo. After the clone finishes the folder is registered and opened as a workspace.',
      'field.repo': 'Repository',
      'field.repoPlaceholder': 'owner/repo or https://github.com/owner/repo',
      'field.parent': 'Clone into (parent folder)',
      'field.parentPlaceholder': 'e.g. C:\\Users\\me\\Documents\\deepseek-harness',
      'field.browse': 'Browse…',
      'field.target': 'Destination',
      'hint.authGh': 'Signed in through the GitHub CLI: private repositories clone with that account.',
      'hint.authNone': 'No GitHub CLI session found. Public repositories clone directly; for a private one run "gh auth login" or use an SSH address.',
      'field.shallow': 'Shallow clone',
      'field.shallowHint': 'Only the latest commit (git clone --depth 1): smaller and faster, without full history.',
      'action.cancel': 'Cancel',
      'action.clone': 'Clone and open',
      'action.cloning': 'Cloning…',
      'notice.added': 'Cloned {name} and added it as a workspace',
      'notice.opened': 'Opened workspace {name}',
      'notice.addedNotOpened': 'Added {name}, but opening a session failed: {detail}',
      'error.repoRequired': 'Enter a repository URL or owner/repo.',
      'error.invalidRepo': 'That repository reference was not recognized. Use owner/repo or a github.com repository URL.',
      'error.invalidPath': 'The destination must be an absolute path.',
      'error.parentUnavailable': 'The destination parent folder could not be created or opened.',
      'error.targetExists': 'That destination already exists and is not empty. Choose another parent folder.',
      'error.gitMissing': 'The git command was not found. Install git and make sure it is on PATH.',
      'error.timeout': 'The clone timed out. Check the network and try again.',
      'error.busy': 'Another clone is already writing to that folder.',
      'error.workspaceFailed': 'The clone finished, but registering the workspace failed: {detail}',
      'error.cloneFailed': 'The clone failed: {detail}',
      'error.authRequired': 'This repository needs a GitHub sign-in and no credential was available. Run "gh auth login" in a terminal, or use the SSH address (git@github.com:owner/repo.git), then try again.',
      'error.repoNotFound': 'The repository does not exist, or the current GitHub account cannot read it.',
      'error.forbidden': 'The request was refused (untrusted origin).',
      'error.cancelled': 'The clone was cancelled.',
      'error.unknown': 'The operation failed: {detail}',
    }

    const zh = {
      'action.label': '从 GitHub 克隆',
      'dialog.title': '从 GitHub 克隆仓库',
      'dialog.subtitle': '输入仓库地址或 owner/repo。克隆完成后会自动注册并打开为 workspace。',
      'field.repo': '仓库',
      'field.repoPlaceholder': 'owner/repo 或 https://github.com/owner/repo',
      'field.parent': '克隆到（父目录）',
      'field.parentPlaceholder': '例如 C:\\Users\\me\\Documents\\deepseek-harness',
      'field.browse': '浏览…',
      'field.target': '目标位置',
      'hint.authGh': '已检测到 gh 登录，私有仓库会用该账号克隆。',
      'hint.authNone': '未检测到 gh 登录：公开仓库可直接克隆；私有仓库请先在终端运行 gh auth login，或改用 SSH 地址。',
      'field.shallow': '浅克隆',
      'field.shallowHint': '只取最新一次提交（git clone --depth 1），体积更小、更快，但没有完整历史。',
      'action.cancel': '取消',
      'action.clone': '克隆并打开',
      'action.cloning': '正在克隆…',
      'notice.added': '已克隆 {name} 并添加为 workspace',
      'notice.opened': '已打开 workspace {name}',
      'notice.addedNotOpened': '已添加 {name}，但打开会话失败：{detail}',
      'error.repoRequired': '请输入仓库地址或 owner/repo。',
      'error.invalidRepo': '无法识别仓库地址。请使用 owner/repo 或 github.com 仓库 URL。',
      'error.invalidPath': '目标路径必须是绝对路径。',
      'error.parentUnavailable': '无法创建或访问目标父目录。',
      'error.targetExists': '目标目录已存在且非空，请换一个父目录。',
      'error.gitMissing': '找不到 git 命令，请确认已安装并加入 PATH。',
      'error.timeout': '克隆超时，请检查网络后重试。',
      'error.busy': '该目录正在被另一个克隆任务使用。',
      'error.workspaceFailed': '克隆完成，但注册 workspace 失败：{detail}',
      'error.cloneFailed': '克隆失败：{detail}',
      'error.authRequired': '该仓库需要 GitHub 登录，但当前没有可用凭据。请先在终端运行 gh auth login，或改用 SSH 地址（git@github.com:owner/repo.git），然后重试。',
      'error.repoNotFound': '仓库不存在，或当前 GitHub 账号没有访问权限。',
      'error.forbidden': '请求被拒绝（来源不受信任）。',
      'error.cancelled': '克隆已取消。',
      'error.unknown': '操作失败：{detail}',
    }

    /** Create one immutable-state store with React-compatible subscription. */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...patch }
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    const dialogStore = createStore({
      open: false,
      repo: '',
      parent: '',
      separator: '\\',
      busy: false,
      error: null,
      /** Clone the latest commit only (`--depth 1`). */
      shallow: false,
      /** 'gh' when the GitHub CLI can supply credentials, 'none', or null before the probe. */
      auth: null,
    })
    const noticeStore = createStore({ text: '', tone: 'success', seq: 0 })
    let noticeSeq = 0
    let defaultsLoaded = false
    /** Services captured in `apply` for the components defined in this factory. */
    let runtime

    /** Subscribe one component to a store. */
    const useStore = store => React.useSyncExternalStore(store.subscribe, store.get, store.get)

    /** Post one JSON request to this plugin's host route. */
    async function post(method, body) {
      const url = new URL(`${API_BASE}/${method}`, document.baseURI)
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (payload?.ok !== true) {
        const error = new Error(payload?.error?.message ?? `HTTP ${response.status}`)
        error.code = payload?.error?.code
        throw error
      }
      return payload.value
    }

    /** Trim a diagnostic for inline display. */
    function clip(text) {
      const value = String(text ?? '').replace(/\s+/g, ' ').trim()
      return value.length > 300 ? `${value.slice(0, 300)}…` : value
    }

    /** Localize one host failure. */
    function describeError(t, error) {
      const detail = clip(error?.message ?? error)
      switch (error?.code) {
        case 'invalid-repo': return t('error.invalidRepo')
        case 'invalid-path': return t('error.invalidPath')
        case 'parent-unavailable': return t('error.parentUnavailable')
        case 'target-exists': return t('error.targetExists')
        case 'git-missing': return t('error.gitMissing')
        case 'timeout': return t('error.timeout')
        case 'busy': return t('error.busy')
        case 'workspace-failed': return t('error.workspaceFailed', { detail })
        case 'clone-failed': return t('error.cloneFailed', { detail })
        case 'auth-required': return t('error.authRequired')
        case 'repo-not-found': return t('error.repoNotFound')
        case 'forbidden': return t('error.forbidden')
        case 'cancelled': return t('error.cancelled')
        default: return t('error.unknown', { detail })
      }
    }

    /** Best-effort repository folder name for the destination preview. */
    function repoNameOf(input) {
      let value = String(input ?? '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '')
      value = value.replace(/\.git$/i, '')
      const parts = value.split(/[\\/:]/).filter(part => part !== '')
      return parts.length === 0 ? '' : parts[parts.length - 1]
    }

    /** Join for display only; the host computes the authoritative path. */
    function previewPath(parent, name, separator) {
      if (parent === '' || name === '') return ''
      const trimmed = parent.replace(/[\\/]+$/, '')
      return `${trimmed}${separator === '' ? '/' : separator}${name}`
    }

    /** Show one transient frame-wide notice. */
    function pushNotice(text, tone = 'success') {
      noticeStore.set({ text, tone, seq: ++noticeSeq })
    }

    /** Load the suggested parent folder and credential status once per page. */
    async function loadDefaults() {
      if (defaultsLoaded) return
      defaultsLoaded = true
      try {
        const value = await post('defaults', {})
        const patch = {
          auth: value?.auth === 'gh' ? 'gh' : 'none',
        }
        if (dialogStore.get().parent === '') {
          // The Host remembers the parent of the last successful clone and
          // shares it with every browser; the platform default is the fallback.
          const remembered = typeof value?.lastParent === 'string' && value.lastParent !== ''
            ? value.lastParent
            : typeof value?.defaultParent === 'string' ? value.defaultParent : ''
          patch.parent = remembered
          patch.separator = typeof value?.separator === 'string' && value.separator !== '' ? value.separator : '\\'
        }
        dialogStore.set(patch)
      } catch {
        defaultsLoaded = false
      }
    }

    /** Open the clone dialog. */
    function openDialog() {
      dialogStore.set({ open: true, error: null })
      void loadDefaults()
    }

    /** Close the clone dialog unless a clone is running. */
    function closeDialog() {
      if (dialogStore.get().busy) return
      dialogStore.set({ open: false, error: null })
    }

    /** Wait until the Workspace feed delivers the new Workspace to this page. */
    function waitForWorkspace(workspaceId, timeoutMs) {
      const workspaces = runtime.ctx.get('workspaces')
      const store = workspaces?.list
      if (store === undefined) return Promise.resolve(false)
      const visible = () => store.getSnapshot().items.some(item => item.workspaceId === workspaceId)
      if (visible()) return Promise.resolve(true)
      return new Promise((resolve) => {
        let settled = false
        let unsubscribe = () => {}
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          unsubscribe()
          resolve(false)
        }, timeoutMs)
        unsubscribe = store.subscribe(() => {
          if (settled || !visible()) return
          settled = true
          clearTimeout(timer)
          unsubscribe()
          resolve(true)
        })
      })
    }

    /** Clone, register, then open the resulting workspace. */
    async function submitClone(t) {
      const state = dialogStore.get()
      const repo = state.repo.trim()
      if (repo === '') {
        dialogStore.set({ error: t('error.repoRequired') })
        return
      }
      dialogStore.set({ busy: true, error: null })
      let value
      try {
        value = await post('clone', { repo, parent: state.parent.trim(), shallow: state.shallow })
      } catch (error) {
        dialogStore.set({ busy: false, error: describeError(t, error) })
        return
      }
      const workspaceId = value?.workspace?.workspaceId
      const label = value?.repo === undefined ? repo : `${value.repo.owner}/${value.repo.name}`
      dialogStore.set({ busy: false, open: false, error: null, repo: '' })
      if (typeof workspaceId !== 'string') {
        pushNotice(t('notice.added', { name: label }), 'success')
        return
      }
      const visible = await waitForWorkspace(workspaceId, 8000)
      if (!visible) {
        pushNotice(t('notice.added', { name: label }), 'success')
        return
      }
      try {
        await runtime.ctx.get('uiWorkspace').openWorkspace(workspaceId)
        pushNotice(t('notice.opened', { name: label }), 'success')
      } catch (error) {
        pushNotice(t('notice.addedNotOpened', { name: label, detail: clip(error?.message ?? error) }), 'warn')
      }
    }

    /** Original repo-with-download glyph, drawn for this plugin. */
    function RepoIcon(props) {
      const size = props.size ?? 16
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
        h('path', { d: 'M4.5 6.2A2.2 2.2 0 0 1 6.7 4H18a1.6 1.6 0 0 1 1.6 1.6v7.2' }),
        h('path', { d: 'M4.5 6.2V18A2.5 2.5 0 0 0 7 20.5h4.6' }),
        h('path', { d: 'M15 12.8V21' }),
        h('path', { d: 'm12.3 18.3 2.7 2.7 2.7-2.7' }),
        h('path', { d: 'M8.1 8.2h7.4' }),
      )
    }

    /** Component-local stylesheet, removed with the component. */
    function Styles() {
      return h('style', { dangerouslySetInnerHTML: { __html: CSS } })
    }

    const CSS = `
.dshgws-foot {
  display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;
  height: 32px; padding: 0 10px; border: 0; border-radius: 8px;
  background: transparent; color: inherit; font: inherit; font-size: 13px;
  cursor: pointer; text-align: left; white-space: nowrap;
}
.dshgws-foot:hover { background: var(--dsw-alias-bg-layer-1); }
.dshgws-foot:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dshgws-foot--rail { width: 36px; height: 36px; padding: 0; justify-content: center; }
.dshgws-foot-label { overflow: hidden; text-overflow: ellipsis; }
.dshgws-backdrop {
  position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(0, 0, 0, 0.42);
}
.dshgws-dialog {
  width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box;
  padding: 20px; border-radius: 14px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28); font-size: 14px; line-height: 1.5;
}
.dshgws-head { display: flex; align-items: center; gap: 10px; }
.dshgws-head h2 { margin: 0; font-size: 16px; font-weight: 600; }
.dshgws-sub { margin: 8px 0 18px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.dshgws-field { display: block; margin-bottom: 14px; }
.dshgws-field > span { display: block; margin-bottom: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshgws-row { display: flex; gap: 8px; align-items: center; }
.dshgws-input {
  flex: 1; min-width: 0; height: 34px; padding: 0 10px; box-sizing: border-box;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; font-size: 13px; outline: none;
}
.dshgws-input:focus { border-color: var(--dsw-alias-brand-primary); }
.dshgws-input:disabled { opacity: 0.7; }
.dshgws-browse {
  flex: none; height: 34px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: inherit; font: inherit; font-size: 13px; cursor: pointer;
}
.dshgws-browse:disabled { opacity: 0.6; cursor: default; }
.dshgws-preview { margin: -4px 0 14px; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; }
.dshgws-hint { margin: -6px 0 14px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dshgws-hint--warn { color: var(--dsw-alias-state-warn-primary); }
.dshgws-check { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.dshgws-check input { width: 14px; height: 14px; margin: 0; accent-color: var(--dsw-alias-brand-primary); }
.dshgws-check-hint { margin: 4px 0 0 22px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }.dshgws-preview code { color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dshgws-error {
  margin-bottom: 12px; padding: 8px 10px; border-radius: 8px; font-size: 12.5px;
  color: var(--dsw-alias-state-error-primary); border: 1px solid var(--dsw-alias-state-error-primary);
}
.dshgws-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.dshgws-btn {
  height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; font-size: 13px; cursor: pointer;
}
.dshgws-btn:disabled { opacity: 0.55; cursor: default; }
.dshgws-btn--primary { border-color: transparent; background: var(--dsw-alias-brand-primary); color: #fff; }
.dshgws-notice {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 75;
  display: flex; align-items: flex-start; gap: 8px; max-width: min(560px, calc(100vw - 32px)); box-sizing: border-box;
  padding: 10px 14px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22); font-size: 13px;
}
.dshgws-dot { flex: none; width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.dshgws-notice--warn .dshgws-dot { background: var(--dsw-alias-state-warn-primary); }
@media (max-width: 560px) {
  .dshgws-actions { flex-direction: column-reverse; }
  .dshgws-btn { width: 100%; }
}
`

    /** The sidebar footer action that opens the dialog. */
    function FooterAction(props) {
      const { t, wide } = props
      return h(React.Fragment, null,
        h(Styles, null),
        h('button', {
          type: 'button',
          className: wide ? 'dshgws-foot' : 'dshgws-foot dshgws-foot--rail',
          title: t('action.label'),
          'aria-label': t('action.label'),
          onClick: openDialog,
        },
          h(RepoIcon, { size: wide ? 14 : 18 }),
          wide ? h('span', { className: 'dshgws-foot-label' }, t('action.label')) : null,
        ),
      )
    }

    /** The clone dialog rendered into `shell.overlay`. */
    function CloneDialog(props) {
      const { t } = props
      const state = useStore(dialogStore)
      React.useEffect(() => {
        if (!state.open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && !dialogStore.get().busy) {
            event.preventDefault()
            closeDialog()
          }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => { document.removeEventListener('keydown', onKeyDown) }
      }, [state.open])
      if (!state.open) return null

      const name = repoNameOf(state.repo)
      const target = previewPath(state.parent.trim(), name, state.separator)
      const busy = state.busy
      return h('div', {
        className: 'dshgws-backdrop',
        onMouseDown: (event) => { if (event.target === event.currentTarget) closeDialog() },
      },
        h(Styles, null),
        h('div', { className: 'dshgws-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dshgws-title' },
          h('div', { className: 'dshgws-head' }, h(RepoIcon, { size: 20 }), h('h2', { id: 'dshgws-title' }, t('dialog.title'))),
          h('p', { className: 'dshgws-sub' }, t('dialog.subtitle')),
          h('form', { onSubmit: (event) => { event.preventDefault(); if (!busy) void submitClone(t) } },
            h('label', { className: 'dshgws-field' },
              h('span', null, t('field.repo')),
              h('input', {
                className: 'dshgws-input',
                type: 'text',
                value: state.repo,
                placeholder: t('field.repoPlaceholder'),
                autoFocus: true,
                disabled: busy,
                spellCheck: false,
                autoComplete: 'off',
                onChange: (event) => { dialogStore.set({ repo: event.target.value, error: null }) },
              }),
            ),
            state.auth === null ? null : h('div', {
              className: state.auth === 'gh' ? 'dshgws-hint' : 'dshgws-hint dshgws-hint--warn',
            }, t(state.auth === 'gh' ? 'hint.authGh' : 'hint.authNone')),
            h('div', { className: 'dshgws-field' },
              h('label', { className: 'dshgws-check' },
                h('input', {
                  type: 'checkbox',
                  checked: state.shallow,
                  disabled: busy,
                  onChange: (event) => { dialogStore.set({ shallow: event.target.checked }) },
                }),
                h('span', null, t('field.shallow')),
              ),
              h('div', { className: 'dshgws-check-hint' }, t('field.shallowHint')),
            ),
            h('div', { className: 'dshgws-field' },
              h('span', null, t('field.parent')),
              h('div', { className: 'dshgws-row' },
                h('input', {
                  className: 'dshgws-input',
                  type: 'text',
                  value: state.parent,
                  placeholder: t('field.parentPlaceholder'),
                  disabled: busy,
                  spellCheck: false,
                  autoComplete: 'off',
                  'aria-label': t('field.parent'),
                  onChange: (event) => { dialogStore.set({ parent: event.target.value, error: null }) },
                }),
                h('button', {
                  type: 'button',
                  className: 'dshgws-browse',
                  disabled: busy,
                  onClick: async () => {
                    try {
                      const picked = await runtime.ctx.get('uiWorkspace').pickDirectory()
                      if (typeof picked === 'string' && picked !== '') dialogStore.set({ parent: picked, error: null })
                    } catch (error) {
                      dialogStore.set({ error: describeError(t, error) })
                    }
                  },
                }, t('field.browse')),
              ),
            ),
            target === '' ? null : h('div', { className: 'dshgws-preview' },
              `${t('field.target')}: `, h('code', null, target)),
            state.error === null ? null : h('div', { className: 'dshgws-error', role: 'alert' }, state.error),
            h('div', { className: 'dshgws-actions' },
              h('button', { type: 'button', className: 'dshgws-btn', disabled: busy, onClick: closeDialog }, t('action.cancel')),
              h('button', { type: 'submit', className: 'dshgws-btn dshgws-btn--primary', disabled: busy }, busy ? t('action.cloning') : t('action.clone')),
            ),
          ),
        ),
      )
    }

    /** Transient frame-wide notice after a clone. */
    function CloneNotice(props) {
      const { t } = props
      const notice = useStore(noticeStore)
      React.useEffect(() => {
        if (notice.text === '') return undefined
        const timer = setTimeout(() => {
          if (noticeStore.get().seq === notice.seq) noticeStore.set({ text: '' })
        }, 5000)
        return () => { clearTimeout(timer) }
      }, [notice.seq, notice.text])
      if (notice.text === '') return null
      return h('div', {
        className: notice.tone === 'warn' ? 'dshgws-notice dshgws-notice--warn' : 'dshgws-notice',
        role: 'status',
      },
        h(Styles, null),
        h('span', { className: 'dshgws-dot', 'aria-hidden': true }),
        h('span', null, notice.text),
      )
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace', 'workspaces'],
      apply(ctx) {
        runtime = { ctx }
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'github-workspace: dictionaries')
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'github-workspace.clone',
          order: 20,
          locale: NS,
        }, FooterAction))
        ctx.slots.inject('shell.overlay', function* () {
          yield ctx.slots.register({
            name: 'shell.overlay',
            id: 'github-workspace.dialog',
            order: 40,
            locale: NS,
          }, CloneDialog)
          yield ctx.slots.register({
            name: 'shell.overlay',
            id: 'github-workspace.notice',
            order: 41,
            locale: NS,
          }, CloneNotice)
        })
      },
    }
  },
})
