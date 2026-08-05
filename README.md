# antd-tui

面向 Agent 的终端 UI 引擎。用一套贴近 [Ant Design](https://ant.design/) 命名的 React 组件库在终端里搭建可鼠标交互的界面,并提供三条抽象通路——声明式 JSON Schema、命令式 `$ui` 活对象树、原生 React 组件——让人类与 Agent 都能生成、驱动同一套页面。

底层渲染基于 [OpenTUI](https://github.com/sst/opentui);运行时为 [Bun](https://bun.sh/)。

## 为什么

终端里做交互界面通常要手写光标、布局与事件循环。antd-tui 把这些收敛成组件:你用 `<Button>`、`<Table>`、`<FormItem>` 的直觉写页面,拿到的是可点击、可聚焦、可滚动的真机终端界面。更进一步,它为 Agent 设计了机器友好的驱动面——Schema 校验、无头快照、Playwright 式驱动会话、以及一块完全由 Agent 经 MCP 工具操控的画布。

## 包结构

Bun workspace,十个包:

| 包 | 职责 |
|---|---|
| `@antd-tui/components` | 纯 React 终端组件库(31 个组件)+ 主题 token + 焦点系统 + 组件白名单元数据 |
| `@antd-tui/engine` | 页面 Schema 校验、`PageView`/`App` 渲染、无头快照与 `--drive` 驱动器、CLI |
| `@antd-tui/formily` | 把 Formily `SchemaField` 映射到组件库(Schema 通路的表单引擎) |
| `@antd-tui/live` | `$ui` 活对象树运行时:真 JS 对象 + 真函数、操作级校验、observable 自驱渲染 |
| `@antd-tui/acp` | ACP 客户端桥:连接 agent 子进程(initialize/session/prompt/update),纯协议、零 UI |
| `@antd-tui/vibe-tui` | 完全由 ACP Agent 驱动的画布,经内置 MCP 工具生成/操作界面 |
| `@antd-tui/antop` | 可嵌入或以 CLI 运行的终端系统监控器 |
| `@antd-tui/anterm` | 内嵌可交互子终端,能跑 `vim` / `htop` / `ssh` |
| `@antd-tui/anshell` | agent 时代的对话式 shell:分诊命令/交互程序/agent |
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

## anterm:内嵌终端

`@antd-tui/anterm` 在页面里嵌一块真正的子终端 —— `vim`、`htop`、`ssh` 都能跑。

实现上没有任何 native 依赖:PTY 用 Bun 1.3 起内置的 `Bun.Terminal`(`Bun.spawn({ terminal })`),屏幕模型用零依赖的 `@xterm/headless`,再把 cell 网格按行合并成 `StyledText` 交给 `<text>` 渲染。

```sh
# 需要真实 TTY;省略命令则跑 $SHELL
bun run anterm
bun run anterm htop
```

```tsx
import { Anterm } from "@antd-tui/anterm"

<Anterm command="bash" autoFocus style={{ flexGrow: 1 }} />
```

四个要点:

- **全键捕获**。终端要收到 Tab(shell 补全)、方向键、Enter,所以它以 `kind: "capture"` 注册进焦点系统,`FocusScope` 不再替它消费任何按键。代价是焦点出不来,需按 `tuiEscapeKey`(默认 `Ctrl+]`,telnet 风格)交还。
- **自建控制终端**。Bun 的 `spawn({ terminal })` 不给子进程建立控制终端(`ps` 里 TT 是 `?`),于是 pty 的 ISIG 找不到前台进程组——Ctrl-C 只回显 `^C`,不产生 SIGINT,作业控制也不工作。Linux 上用 util-linux 的 `setsid --ctty` 补上这一步;其他平台降级为直接运行(显示与输入照常,信号键失效)。
- **鼠标按协商级别透传**。子进程经 DECSET 1000/1002/1003 声明追踪级别,组件据此过滤事件种类,并按 1006 决定用 SGR 还是 X10 编码。注意 DECSET 允许合并参数(htop 发的是 `\x1b[?1006;1000h`),必须按参数拆开判断,否则会退化成 X10 而让子进程把坐标字节读成按键。子进程没要鼠标时,滚轮用来翻组件自己的回看缓冲。
- **ANSI 0-15 走自带色板**。opentui 会把 palette 索引摊平成 xterm 的静态默认值(ANSI 1 是 `#800000`),放在现代终端里内容会明显发闷,所以组件自带一张 Campbell 色板,可经 `tuiPalette` 覆盖。索引 16-255 是与主题无关的标准 256 色立方体,不受影响。

## anshell:对话式 shell

`@antd-tui/anshell`(CLI `ansh`)不是传统 shell,而是一个对话框:输入经启发式分诊走三条路——

- **命令**:首词能在 PATH 解析,或整行含 shell 元字符(`| > & ; $` …)→ 经 `sh -lc` 一次性跑,输出流式回显进对话。
- **交互程序**:首词是 `bash`/`vim`/`htop`/`ssh` 等 → 压入视图栈,嵌入 `@antd-tui/anterm` 全屏接管;程序结束(`exit`/`:q`/`q`)出栈回对话框。
- **agent**:无法解析的自然语言 → 交给 agent(配置了 `--agent` 时经 `@antd-tui/acp` 走 prompt/stream;否则回一句系统提示)。

```sh
# 需要真实 TTY
bun run ansh
bun run ansh --agent "<agent 启动命令>"
```

```tsx
import { Anshell } from "@antd-tui/anshell"

<Anshell agentCmd={["qodercli", "--acp"]} />
```

要点:

- **视图栈建模**。对话为基座,交互程序压栈接管,为后续「窗口嵌套」预留结构。
- **退出用 Ctrl-D / exit**(标准 shell 约定,天然分层:内嵌程序先收到就自己结束出栈,对话层再收到才退 anshell);**Ctrl-C 只中断**在跑的命令,不退出。
- **cd 在宿主内维护**:子进程改不了宿主 cwd,故 `cd`/`pwd`/`clear`/`exit` 作为内建在 anshell 里处理,cwd 传给后续命令与嵌入终端。
- 命令历史经 ↑↓ 翻阅(`Input` 无方向键钩子,由组件级 `useKeyboard` 处理)。

## 组件


31 个组件,命名与语义对齐 antd:`Button` / `Input` / `InputNumber` / `TextArea` / `Select` / `Checkbox` / `Radio` / `Switch` / `Slider` / `FormItem` / `Typography`(Text/Title/Link)/ `Card` / `Space` / `Flex` / `Row` / `Col` / `List` / `Table` / `Descriptions` / `Statistic` / `Progress` / `Tag` / `Alert` / `Divider` / `Spin` / `Modal` / `message` 等。

命名原则:与 antd **行为完全一致**的字段沿用原名(如 `type`、`options`、`onChange`);因终端适配而**行为相近但不同**的字段加 `tui` 前缀(如 `tuiOnClick` 无 DOM 事件参、`tuiHotkey` 全局热键、`tuiScroll` 滚动视口)。样式经 `style`(CSS 子集:`width`/`flex`/`flexGrow`/`flexShrink`/`flexBasis`/`padding`/`margin*`/`color`/`backgroundColor`/`textAlign`/`overflow`)表达。

## 开发

```sh
bun run typecheck   # tsc --noEmit
bun test            # 全量测试(进程内渲染真帧)
```

测试基于 `@antd-tui/test-utils` 的进程内渲染器,断言真实字符帧,与真机渲染同一管线。
