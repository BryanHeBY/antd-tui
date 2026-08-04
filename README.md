# antd-tui

面向 Agent 的终端 UI 引擎。用一套贴近 [Ant Design](https://ant.design/) 命名的 React 组件库在终端里搭建可鼠标交互的界面,并提供三条抽象通路——声明式 JSON Schema、命令式 `$ui` 活对象树、原生 React 组件——让人类与 Agent 都能生成、驱动同一套页面。

底层渲染基于 [OpenTUI](https://github.com/sst/opentui);运行时为 [Bun](https://bun.sh/)。

## 为什么

终端里做交互界面通常要手写光标、布局与事件循环。antd-tui 把这些收敛成组件:你用 `<Button>`、`<Table>`、`<FormItem>` 的直觉写页面,拿到的是可点击、可聚焦、可滚动的真机终端界面。更进一步,它为 Agent 设计了机器友好的驱动面——Schema 校验、无头快照、Playwright 式驱动会话、以及一块完全由 Agent 经 MCP 工具操控的画布。

## 包结构

Bun workspace,七个包:

| 包 | 职责 |
|---|---|
| `@antd-tui/components` | 纯 React 终端组件库(31 个组件)+ 主题 token + 焦点系统 + 组件白名单元数据 |
| `@antd-tui/engine` | 页面 Schema 校验、`PageView`/`App` 渲染、无头快照与 `--drive` 驱动器、CLI |
| `@antd-tui/formily` | 把 Formily `SchemaField` 映射到组件库(Schema 通路的表单引擎) |
| `@antd-tui/live` | `$ui` 活对象树运行时:真 JS 对象 + 真函数、操作级校验、observable 自驱渲染 |
| `@antd-tui/vibe-tui` | 完全由 ACP Agent 驱动的画布,经内置 MCP 工具生成/操作界面 |
| `@antd-tui/antop` | 可嵌入或以 CLI 运行的终端系统监控器 |
| `@antd-tui/test-utils` | 进程内终端渲染的测试夹具 |

## 三条通路

同一个页面可以用三种方式表达,`examples/` 下的计算器与运维面板各有三份等价实现,可对照阅读:

| 通路 | 形态 | 换页 | 联动 | 校验 | 适用 |
|---|---|---|---|---|---|
| **schema** (`examples/schema/`) | 声明式 JSON | `x-visible` | `x-reactions` | `x-validator` | Agent 生成、可静态校验的页面 |
| **repl** (`examples/repl/`) | 命令式 `$ui` 活对象树 | `$ui.clear()` 重建 | `$ui.watch` 插删 | 真函数写回 FormItem | 增量搭建、真闭包逻辑 |
| **react** (`examples/react/`) | 原生 React 组件 | 条件渲染 | `useState` | 普通函数 | 手写应用 |

## 快速开始

```sh
bun install

# 计算器:三种通路
bun run examples:calc          # schema 版(engine 渲染 JSON)
bun run examples:calc:repl     # repl 版($ui 活对象树)
bun run examples:calc:react    # 原生 React 版

# 运维控制台:登录页 + App Shell(顶栏/侧栏/多区域),覆盖全部组件
bun run examples:dash
bun run examples:dash:repl
bun run examples:dash:react

# antop:原生 React 的现代终端资源监视器(htop/btop 风格)
bun run antop
```

示例需要在真实终端(TTY)中运行。

## engine:给 Agent 的驱动面

engine 把页面 Schema 当作可校验、可无头驱动的产物:

```sh
# 校验(不渲染)
bun packages/engine/src/cli.ts --schema examples/schema/dashboard.json --dry-run

# 导出单帧:字符画 / ANSI 彩色 / SVG 矢量图
bun packages/engine/src/cli.ts --schema x.json --snapshot --format svg > x.svg

# Playwright 式交互会话(stdin/stdout NDJSON:看帧 → 点击/输入 → 再看帧)
bun packages/engine/src/cli.ts --schema x.json --drive
```

交互结果以 NDJSON 写回 stdout(`{"event":"submit","values":{...}}` / `{"event":"cancel"}`)。详见 [`docs/schema-guide.md`](docs/schema-guide.md) 与 [`docs/driver.md`](docs/driver.md)。

编译为独立二进制:

```sh
bun run build:bin   # → dist/antd-tui-engine
```

## vibe-tui:Agent 驱动的画布

`vibe-tui` 是一块完全由 Agent 驱动的终端界面:人类在底部输入框对话,Agent 经 [ACP](https://agentclientprotocol.com/) 连入,通过内置 MCP 工具在 `$ui` 活对象树上生成、操作界面。

```sh
# 用内置 mock agent 体验
bun run vibe:mock

# 接入真实 ACP agent
bun packages/vibe-tui/src/cli.ts --agent "qodercli --acp"
```

MCP 工具:`vibetui_eval`(会话级 JS REPL)、`vibetui_snapshot` / `vibetui_host_snapshot`(页面/宿主截帧)、`vibetui_layout`(Row/Col 布局诊断)、`vibetui_inspect`(节点 props 与可见文本)、`vibetui_dispatch`(语义事件自测)、`vibetui_reset`(清空页面与 REPL 作用域)、`vibetui_guide`(编写规范)、`vibetui_example`(参考实现源码)。会话就绪后自动注入引导:默认可直接执行完整 JS；不熟悉 API 或搭复杂壳时按需读取 guide/example；只有需要尽早展示中间结果时再分区增量构建。

交互:输入框输入 prompt(Enter 发送);F2 进入页面模式操作画板,F3 对话记录,Esc 返回;鼠标随时可点画板。

## antop:终端系统监控器

`@antd-tui/antop` 是仓库内独立的 React workspace package，同时提供真实终端 CLI。它采集 CPU、内存、磁盘 IO 与进程数据，支持 CPU / IO / 看板页、表头排序、列宽拖动和进程详情弹窗。

```sh
# 需要真实 TTY
bun run antop
```

作为组件嵌入时可传入 `snapshot` 做确定性渲染/测试，或省略它以自动采样本机数据：

```tsx
import { Antop } from "@antd-tui/antop"

<Antop />
```

## 组件

31 个组件,命名与语义对齐 antd:`Button` / `Input` / `InputNumber` / `TextArea` / `Select` / `Checkbox` / `Radio` / `Switch` / `Slider` / `FormItem` / `Typography`(Text/Title/Link)/ `Card` / `Space` / `Flex` / `Row` / `Col` / `List` / `Table` / `Descriptions` / `Statistic` / `Progress` / `Tag` / `Alert` / `Divider` / `Spin` / `Modal` / `message` 等。

命名原则:与 antd **行为完全一致**的字段沿用原名(如 `type`、`options`、`onChange`);因终端适配而**行为相近但不同**的字段加 `tui` 前缀(如 `tuiOnClick` 无 DOM 事件参、`tuiHotkey` 全局热键、`tuiScroll` 滚动视口)。样式经 `style`(CSS 子集:`width`/`flex`/`flexGrow`/`flexShrink`/`flexBasis`/`padding`/`margin*`/`color`/`backgroundColor`/`textAlign`/`overflow`)表达。

## 开发

```sh
bun run typecheck   # tsc --noEmit
bun test            # 全量测试(进程内渲染真帧)
```

测试基于 `@antd-tui/test-utils` 的进程内渲染器,断言真实字符帧,与真机渲染同一管线。
