# GitHub 仓库工作区

DeepSeek Harness 默认通过选择本地文件夹来添加 workspace。这个插件增加另一种入口：输入一个 GitHub 仓库地址，自动克隆到指定目录，并立即注册为 workspace。

## 功能

- **输入**：仓库 URL（`https://github.com/owner/repo`、`git@github.com:owner/repo.git`、`github.com/owner/repo`）或简写 `owner/repo`。
- **目标目录**：输入或用系统文件夹选择器挑选父目录，仓库会克隆到 `<父目录>/<仓库名>`；父目录不存在时会自动创建。
- **克隆**：在 Host 进程里执行 `git clone`。检测到 GitHub CLI 已登录时（`gh auth login`），用它的 token 认证 HTTPS 克隆，私有仓库无需改动 git 全局配置；token 只作为一次性的环境配置传给 git，不出现在命令行、克隆地址或 `.git/config` 里。没有 gh 登录时退回本机 git 凭据与 SSH agent。交互式提示保持禁用，默认 10 分钟超时。
- **加载为 workspace**：克隆成功后通过 Workspace 注册表登记该目录，侧边栏立即出现新的 workspace（所有已连接的浏览器都会同步），并自动打开其中的会话。

## 私有仓库

对话框会显示是否检测到 gh 登录。私有仓库先在终端执行一次 `gh auth login`，然后直接填 `owner/repo` 即可；也可以填 SSH 地址（`git@github.com:owner/repo.git`）走 SSH key。若克隆因缺少凭据失败，错误会给出这两条处理路径，而不是原始 git 报错。

## 入口

侧边栏底部、设置上面新增一行 **从 GitHub 克隆**。点开后是包含「仓库」「克隆到（父目录）」「目标位置」的对话框；侧边栏收成窄栏时显示为图标。

## 注意事项

- 克隆以 Host 进程用户身份运行。私有仓库需要该账号已 `gh auth login`、已存 git 凭据，或配好 SSH key；由于禁用了交互式提示，缺少凭据会直接报错并给出处理建议，而不是卡住等待输入。
- 只接受 github.com。GitHub Enterprise 主机名会被拒绝，并在错误里说明。
- 目标目录 `<父目录>/<仓库名>` 已存在且非空时会拒绝覆盖；克隆失败时，本插件创建的空目录会被清理。
- 注册 workspace 不会改动克隆目录以外的文件；之后删除 workspace 也不会删除已经克隆下来的仓库。
