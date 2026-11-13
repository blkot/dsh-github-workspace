# dsh-github-workspace

把 GitHub 仓库克隆到指定目录，并立即注册为
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 workspace——不用先在终端克隆、再手动添加文件夹。

[English](README.md) | 中文说明

## 功能

- **仓库输入**：`owner/repo`、`https://github.com/owner/repo`、`github.com/owner/repo`，或 SSH 地址 `git@github.com:owner/repo.git`。
- **目标目录**：手输父目录，或用系统文件夹选择器挑选；仓库会克隆到 `<父目录>/<仓库名>`，父目录不存在时自动创建。
- **私有仓库**：检测到 GitHub CLI 已登录时，用它的 token 认证 HTTPS 克隆，不需要 SSH key，也不改动用户的 git 配置。
- **自动加载**：克隆完成后通过 Workspace 注册表登记，侧边栏立即出现该 workspace（所有已连接浏览器同步），并打开一个新会话。
- **界面本地化**：中英文文案，跟随应用语言。

## 环境要求

- DeepSeek Harness `>= 0.2.0`，Web 或 Desktop GUI。
- Host 的 `PATH` 中有 `git`。
- 可选：[GitHub CLI](https://cli.github.com/)（`gh auth login`），仅私有仓库走 HTTPS 克隆时需要。

## 安装

1. 把本仓库克隆到一个固定位置：

   ```sh
   git clone https://github.com/blkot/dsh-github-workspace.git
   ```

2. 打开 DeepSeek Harness 的 **设置 → 插件 → 添加插件**，选择克隆下来的目录（等同于用插件管理器安装该目录）。

插件以链接方式引用该目录，启用期间不要移动或删除它。Host 端代码的改动在下次启动应用后生效。

## 使用

点击侧边栏底部、**设置** 上方的 **从 GitHub 克隆**，填写仓库与父目录，点 **克隆并打开**。对话框会在执行前显示解析后的目标路径。

侧边栏收成窄栏时，这一行显示为图标。

## 配置

可在 profile 的 `cordis.patch.yml` 中为 bundle 行设置：

```yaml
- id: github-workspace
  name: 'dsh-github-workspace'
  config:
    cloneRoot: ''        # 建议的父目录；留空 = 文档/deepseek-harness
    gitCommand: git      # 用于克隆的可执行文件
    ghCommand: gh        # 用于读取 token 的 GitHub CLI
    auth: auto           # auto = 使用已登录的 gh token；none = 只用普通 git 凭据
    timeoutMs: 600000    # 单次克隆超时（毫秒）
```

## 认证

私有仓库只需在本机执行一次 `gh auth login`。对话框会显示是否检测到 gh 登录，克隆时通过 `gh auth token` 读取 token。

token 以**一次性环境配置**（`http.https://github.com/.extraheader`）交给 git，因此：

- 不出现在命令行或进程列表中；
- 不进入克隆地址；
- 不写入仓库的 `.git/config`。

没有 gh 登录时会退回普通 `git clone`，使用 Host 自己的 git 凭据（凭据管理器或已保存凭据）。SSH 地址始终走 SSH agent，因此有效的 key 不需要 token。

交互式密码提示被刻意禁用：缺少凭据时会立即失败并给出可操作的提示，而不是让克隆静默挂起。

## 实现方式

| 部分 | 文件 | 职责 |
|---|---|---|
| Host | [`index.js`](index.js) | 在 Connection 信任栅栏后提供同源 `POST /dsh-github-workspace/api` 路由：解析仓库引用、解析父目录、执行 `git clone`，再用 `ctx.workspaceRegistry.create()` 注册。 |
| Client | [`client.js`](client.js) | `sidebar.footer.action` 按钮与 `shell.overlay` 对话框；克隆完成后等待 Workspace feed 并打开新 workspace。 |

克隆有边界限制（请求体大小、超时、同一目标同时只允许一个克隆），失败时只清理本插件创建的目录。

## 限制

- 只支持 **github.com**；GitHub Enterprise 主机名会被拒绝并提示具体主机。
- 目标目录 `<父目录>/<仓库名>` 已存在且非空时拒绝覆盖。
- 注册 workspace 不会改动克隆目录以外的文件；之后删除 workspace 也不会删除已经克隆下来的仓库。
- 不提供模型工具，这是面向用户的手动操作。

## 许可证

[MIT](LICENSE) © 2026 Blackout
