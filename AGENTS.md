# AGENTS.md

> pnpm workspace 单仓：把外部开发方法论打包成 **DSH（DeepSeek Harness）bundle 插件**。
> 最高优先级：**不要破坏已发布的插件契约** —— `package.json` 的 `dsh`/`files`、`cordis.patch.yml`、`lib/index.js` 的导出形状。

## 1. 仓库地图

| 目录 | 提供 | 测试 |
|---|---|---|
| `dsh-colgrep` | `colgrep` 模型工具（语义检索，`root` 可指定项目） | 20 |
| `dsh-codegraph` | 经 MCP 注册 `mcp__codegraph__*` 工具 + 无索引时的建图引导 | 5 |
| `dsh-project-mcp` | 读会话项目根的 `.mcp.json`，把其中的 MCP server 挂进该 agent 自己的 scope（按会话隔离、子 agent 继承） | 25 |
| `dsh-gitbash` | Windows 上接入 Git Bash：realm 组内提供 `ctx.shell` + 宿主 `bash` 工具 | 37 |

npm 名统一为 `@hilariouhiss/<目录名>`。依赖：`colgrep` → `dsh-tools`；`codegraph`、`project-mcp` → `dsh-mcp-client`；`gitbash` → `dsh-bash-sandbox` + `dsh-tool-bash`。这四者（`dsh-tools`、`dsh-mcp-client`、`dsh-bash-sandbox`、`dsh-tool-bash`）都是**宿主提供的 peer**，见 §3.4。

## 2. 插件如何工作

`dsh plugin --profile <p> add <pkg>` → 装进 profile 的 `node_modules` → DSH 读到 `package.json` 的 `dsh.bundle.patch` → 启动时应用 `cordis.patch.yml` 的 `- insert: [{ id, name }]` → DSH 用 `name` 解析该包并调用 `apply(ctx)`。
运行在 **host plane**，注册物进入 global layer：对该 profile 的**所有 preset、所有会话**可见。

```js
export const name = "colgrep";
export const inject = ["tools", "shell", "sandboxPolicy", "systemPrompt"];  // 用到的服务必须列全
export function apply(ctx) { /* 注册提示词段 / 模型工具 */ }
```

| ctx 服务 | 用途 |
|---|---|
| `ctx.systemPrompt.section({ name, order, text })` | 注入提示词段；`text` 可为 `(context) => string`，每回合重算 |
| `ctx.tools.register(defineTool({ ... }))` | 模型工具 |
| `ctx.shell.resolve` → `ctx.shell.execute` → `result()` + `ctx.sandboxPolicy.resolve` | 在沙箱策略内调用外部 CLI（0.1.7 起 `execute()` 先给进程句柄，结算结果在 `result()` 上；旧的 `run()` 已移除） |
| `ctx.plugin({ inject, apply }, config)` | 嵌套加载其它插件 |

## 3. 硬性不变量（破坏即发布事故）

1. `cordis.patch.yml` 的 `name` 必须**逐字等于** `package.json` 的 `name`。
2. `files` 白名单要含全部运行时文件（本仓统一是 `lib/`、`cordis.patch.yml`、`README.md`、`LICENSE`），否则发出去的包里没有运行时文件，插件加载即失败。
3. `inject` 漏列服务 → 该插件行静默不激活。
4. **`@deepseek-ai/*` 只能进 `peerDependencies`，绝不进 `dependencies`。** 写成 `dependencies` 会让 pnpm 把这份副本 hoist 进 profile 的 `node_modules`，**遮蔽**安装目录里的同名包（`$DSH_HOME/profiles/node_modules` 的镜像）；两代混装会在 ESM 链接期炸掉整棵插件树 —— 连宿主自己的核心 `tools` 行一起，`dsh` 直接 exit 1。peer 范围写 `^<该包真正兼容的那一代>` 作为兼容下限声明，`devDependencies` 写**精确版本**供本仓安装与测试解析。当前运行时是 `0.2.1-alpha.4`，**全部 4 个包统一声明 `^0.2.1-alpha.4` / `devDependencies` 精确 `0.2.1-alpha.4`**。**注意 `^` 范围对预发布版本的语义**：`^0.1.5-rc.2`、`^0.1.7-alpha.1`、`^0.2.0-rc.2` 都**不**匹配 `0.2.1-alpha.4`（semver 只在元组相同时放行预发布），所以旧声明会让 **pnpm 的 peer 解析**失败（别指望宿主的兼容闸门替你发现：0.2.1-alpha.4 起 `dsh-app-boot` 的 `unmetRequirements` 用 `includePrerelease: true` 匹配 `@deepseek-ai/dsh*` peer，`^0.2.0-rc.2` 照样过闸）—— `peerDependencies` 的"兼容下限声明"不等于 pnpm 的兼容性保证，接缝得靠测试守（§4 的"打到真实基类"）。
5. 各包的 `name`/`inject`/`apply` 导出形状与 `test/` 断言是对外契约。
6. 行尾 **LF**（`.gitattributes` 已强制）；测试必须**离线可跑**（不联网，不依赖 `colgrep`/`codegraph` CLI）。

## 4. 代码与测试风格

- ESM、import 带显式 `.js` 后缀、Node ≥ 20；**纯 JS + JSDoc，无 TypeScript、无构建步骤**；**缩进用 TAB**；双引号、分号；具名导出；私有字段 `#`；注释写 why 不写 what。
- 测试用 Node 内置 `node:test` + `node:assert/strict`，零依赖。**不启动真实 DSH**：手写 fake `ctx` 捕获注册调用，`mkdtempSync` 临时目录做 fixture。覆盖导出形状、注册次数、argv 组装、渲染函数与**错误分支**。
- 运行：`pnpm install` → `pnpm test`。**在 DSH 沙箱内 `pnpm test` 会以 `spawn EPERM` 失败** —— 沙箱禁止带管道的子进程 stdio，而 `node --test` 要为每个测试文件 spawn 子进程；这是**环境限制，不是测试失败**，改在包目录内跑 `node --test-isolation=none --test`。基线：**87 个测试全绿**（20/5/25/37）；全部 4 个包的 `devDependencies` 已统一跟到运行时那一代（`0.2.1-alpha.4`）。新增排除项要同步 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（刚发布的预发布版会被 pnpm 的发布时长策略挡掉，报成 `ERR_PNPM_NO_MATCHING_VERSION`）—— 每加一代替换一次该代版本号，`dsh-*` 追加到已有的 `||` 列表里，而 `cordis` / `cordis-plugin-*` / `cosmokit` / `schemastery` 是**独立版本线**，只追加它们自己的版本号，别写成 `0.2.1-alpha.4`。
- **`lib/` 里凡是导入宿主包的模块，在沙箱内都跑不了测试**（见 §6 的 reparse point 条目）。要测的逻辑就放进不导入宿主包的模块：`dsh-project-mcp` 的 `lib/config.js` 零宿主依赖、分支全覆盖地跑单测，`lib/index.js` 只承担宿主接缝。沙箱内需要真实依赖时，用 `npm install <pkg>` 在临时目录建一份真实目录布局再跑（`npm` 不走 pnpm 的符号链接农场）。
- **覆写宿主接缝的插件，测试必须打到真实基类**：0.1.7 把执行器接缝从 `run`/`start`/`runArgv`/`startArgv` 改成 `execute`/`executeArgv`，覆写旧名字在 import 期**完全静默**，只在调用时表现为"跑错 shell"。`dsh-gitbash/test/manifest.test.js` 因此既断言接缝名/参数个数，也用真实 `SandboxBashExecutor`（只假 `ctx.subprocess`）跑一遍完整调用链——纯 fake 基类会把宿主的行为变成测试自己的假设。
- 单元测试跑的是仓内 `devDependencies`，**看不到 profile 里的模块遮蔽**。真实安装 + 真启动的冒烟检查是唯一能抓到那一类的方式：`node scripts/smoke-profile.mjs`（需联网 + `pnpm` + PATH 上的 `dsh`，非 `pnpm test` 的一部分）。
- 绝不为"让测试变绿"而削弱断言或删测试；先判断是**行为错了**还是**期望错了**，说清依据再改。

## 5. 新增插件

- 新增插件：照抄现有包骨架（`package.json`、`cordis.patch.yml`、`lib/index.js`、`test/index.test.js`、`test/manifest.test.js`、`README.md`、`LICENSE`）→ 加进根 `pnpm-workspace.yaml` → 根 `package.json` 加 `publish:<pkg>` 脚本 → 根 `README.md` 补一行 → 写测试 → **`test/manifest.test.js` 里列出该插件用到的 `@deepseek-ai/*` 并按 §3.4 声明** → `dsh plugin --profile <p> add link:./<pkg>` 本地验证 → 发版前 `node scripts/smoke-profile.mjs` 走一遍真实安装 + 真启动。
- 提交用 **Conventional Commits**（英文）：`feat:`/`fix:`/`docs:`/`refactor:`/`chore:`/`test:`；一个提交只做一件事。

## 6. 常见陷阱

| 症状 | 原因 / 对策 |
|---|---|
| 重启后插件"没生效" | `cordis.patch.yml` 的 `name` 与包名不一致，或 `inject` 少列服务 |
| 升级 DSH 后插件崩 | `@deepseek-ai/*` 是预发布版，公开 API 可能变；同步 peer 范围与 `devDependencies`，再跑 `node scripts/smoke-profile.mjs` |
| 工具调用报 `ctx.shell.run is not a function`，或 `bash` 跑成了 WSL | 宿主把执行器接缝改名了（0.1.7：`run`/`start`/`runArgv`/`startArgv` → `execute`/`executeArgv`，`ctx.sandbox.confine` 变异步三参）。覆写不存在的名字**加载期无任何报错**，只在调用时暴露；按 §4 的"打到真实基类"补一条守卫测试，别只改调用点 |
| `dsh` 直接起不来、报 `does not provide an export named ...` | profile 里 hoist 了 `@deepseek-ai/*` 旧副本（§3.4）。`ls ~/.dsh/profiles/<p>/node_modules/@deepseek-ai` 有内容即为命中；修 `package.json` 后让用户 `dsh plugin --profile <p> update` |
| 单元测试全绿、真实安装却炸 | 单测跑仓内 `devDependencies`，看不见 profile 遮蔽；用 `node scripts/smoke-profile.mjs` |
| 沙箱内 `pnpm install` 报 `UNKNOWN: unknown error, open '...node_modules\\.pnpm\\...'`，随后所有 `ERR_MODULE_NOT_FOUND` | 沙箱把**工作区内的 reparse point（符号链接/junction）对子进程设为不可遍历**：`.pnpm` 里的真实目录读得到，经过链接就读不到（`scandir ... UNKNOWN`）。这不是依赖坏了，是环境限制。对策：① 别在沙箱里跑 `pnpm install`，让用户在普通终端跑；② 要在沙箱内测某个依赖真实行为的模块，用 `npm install <pkg>` 在临时目录建**真实目录**布局，再把 `lib/`+`test/` 拷进去跑（见 §4）；③ 链接被上一次安装写坏时，`readlinkSync` 仍可用，用它重建 junction 即可恢复。 |

## 7. "完成"的定义

- 测试全绿（看得见输出）＋ 对应断言同步更新 ＋ 逐条对照 §3 不变量 ＋ README/版本号一并更新。没做到就**如实说没做到**，不要用模糊措辞掩盖。
