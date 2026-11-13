# dsh-github-workspace

Clone a GitHub repository into a folder you choose and register the checkout as a
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) workspace — one
dialog instead of "clone in a terminal, then add the folder".

English | [中文说明](README.zh.md)

## Features

- **Repository input** — `owner/repo`, `https://github.com/owner/repo`,
  `github.com/owner/repo`, or an SSH remote such as `git@github.com:owner/repo.git`.
- **Destination** — type a parent folder or pick one with the Host folder chooser.
  The checkout lands in `<parent>/<repo>`; missing parent folders are created.
- **Private repositories** — when the GitHub CLI is signed in, its token
  authenticates the HTTPS clone. No SSH key required, and the user's git
  configuration is left untouched.
- **Automatic loading** — the checkout is registered through the Workspace
  registry, appears in the sidebar on every connected browser at once, and opens
  a new session in it.
- **Localized** — English and Chinese UI, following the application language.

## Requirements

- DeepSeek Harness `>= 0.2.0` with the Web or Desktop GUI.
- `git` on the Host `PATH`.
- Optional: the [GitHub CLI](https://cli.github.com/) (`gh auth login`), needed
  only for private repositories that are cloned over HTTPS.

## Install

1. Clone this repository somewhere permanent:

   ```sh
   git clone https://github.com/blkot/dsh-github-workspace.git
   ```

2. In DeepSeek Harness, open **Settings → Plugins → Add plugin** and choose the
   cloned directory. (Equivalently, install the directory with the plugin
   manager.)

The bundle links that directory, so keep it where it is while the plugin is
enabled. Changes to Host code load on the next application start.

## Usage

Click **Clone from GitHub** in the sidebar footer, directly above **Settings**.
Enter a repository and the parent folder, then press **Clone and open**. The
dialog shows the resolved destination before anything runs.

The row collapses to an icon when the sidebar is a rail.

## Configuration

The bundle row accepts these keys in the profile's `cordis.patch.yml`:

```yaml
- id: github-workspace
  name: 'dsh-github-workspace'
  config:
    cloneRoot: ''        # suggested parent; empty = Documents/deepseek-harness
    gitCommand: git      # executable used to clone
    ghCommand: gh        # GitHub CLI used to read a token
    auth: auto           # auto = use a signed-in gh token; none = plain git only
    timeoutMs: 600000    # one clone's deadline, in milliseconds
```

## Authentication

`gh auth login` once per machine is all a private repository needs. The dialog
shows whether a GitHub CLI session was found, and the clone reads its token
through `gh auth token`.

The token reaches git as a **one-shot environment configuration**
(`http.https://github.com/.extraheader`), so it:

- never appears on a command line or in a process list,
- never becomes part of the clone URL,
- and never lands in the repository's `.git/config`.

Without a GitHub CLI session, plain `git clone` runs with the Host's own git
credentials (a credential manager or stored credentials). An SSH reference
always clones over SSH and uses the SSH agent, so a working key needs no token.

Interactive password prompts are disabled deliberately: a missing credential
fails fast with an actionable message instead of leaving a clone hanging.

## How it works

| Half | File | Responsibility |
|---|---|---|
| Host | [`index.js`](index.js) | One same-origin `POST /dsh-github-workspace/api` route behind the Connection trust fence: parses the reference, resolves the parent folder, runs `git clone`, then registers the checkout with `ctx.workspaceRegistry.create()`. |
| Client | [`client.js`](client.js) | A `sidebar.footer.action` button and a `shell.overlay` dialog; after a clone it waits for the Workspace feed and opens the new workspace. |

The clone is bounded (body size, deadline, one clone per destination) and a
failed attempt removes only the directory this plugin created.

## Limitations

- Only **github.com** is supported; GitHub Enterprise hosts are rejected with a
  message naming the host.
- A non-empty `<parent>/<repo>` is refused rather than overwritten.
- Registering the workspace never touches files outside the new checkout, and
  deleting the workspace later leaves the cloned folder on disk.
- The model gets no clone tool; the feature is a human-initiated UI action.

## License

[MIT](LICENSE) © 2026 Blackout
