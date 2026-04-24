# NEXT.md — skillstash 路线图

本文件记录了项目已识别的改进点，包括计划中和推迟的项目。欢迎社区贡献！

---

## 已在 v0.8.0 实现

| 类别 | 功能 |
|---|---|
| 架构 | agent 插件机制 — 支持自定义 agent 注册，告别硬编码 |
| 架构 | 并发保护（文件锁）— 防止多进程同时写入 registry |
| 架构 | git 操作全面补充超时，避免大仓库卡死 |
| UX | `skillstash init` 默认本地模式，无需先配 Git remote |
| UX | 新增 `skillstash add-remote <url>` 命令 |
| UX | `install` 错误诊断增强（GitHub 仓库不存在、认证失败、超时） |
| UX | `sync` 显示 spinner 和进度计数器 |
| 基础设施 | CHANGELOG.md / CONTRIBUTING.md |
| 基础设施 | CI 增加 Windows 测试和构建验证 |
| 基础设施 | package.json author / publishConfig 修复 |

---

## 待实现（欢迎 PR）

### 高优先级

- **`skillstash update <name>`** — 从原始来源（ClawHub / GitHub）拉取最新版本，更新哈希
- **`skillstash info <name>`** — 查看单个 skill 的详细信息（版本、来源、描述、文件列表）
- **`skillstash validate <name>`** — 独立运行 SKILL.md lint 验证，无需重新安装

### 中优先级

- **`skillstash search <keyword>`** — 搜索 ClawHub / GitHub 上可用的 skill
- **`skillstash rollback <name>`** — 回退到 hub git 历史中的某个 skill 版本
- **`skillstash config`** — 查看/修改 hub 配置（默认路径、link type 等）
- **`skillstash export <name>`** — 将 skill 导出为 tar.gz 或可直接分享的格式
- **`--json` 全局标志** — 所有命令支持 JSON 格式输出，便于脚本集成和 CI/CD
- **`--quiet` 全局标志** — 静默模式，仅输出错误

### 低优先级

- **`skillstash diff` 增强** — 文件级差异（当前只有目录级别 in-sync/out-of-sync）
- **签名验证** — 验证 GitHub 来源 skill 的 SSH/GPG 签名，防御供应链攻击
- **自更新** — `skillstash self-update` 或版本检查提示
- **`sync` 并行链接** — 多 agent 并发链接，提升大量 skill 时的性能

---

## 已知限制

- 要求 Node.js >= 20.12.0
- `init <remote-url>` 仍需 git 可用
- 暂不支持私有 npm registry 的 skill 分发
- Windows 上 junction 链接模式在某些场景下不可用（依赖系统权限）
