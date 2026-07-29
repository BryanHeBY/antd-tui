/**
 * agent 冷启动知识：硬编码的引导 prompt 与 $ui 精简指南。
 * vibe-tui 可能运行在任意 cwd（乃至编译产物中），不能依赖仓库文档文件，
 * 因此关键规范内嵌于此。
 */

/** 会话就绪后立即注入（新建与恢复都注入）：让 agent 知道自己身处 vibe-tui */
export const BOOT_PROMPT = [
  "你已连接 vibe-tui —— 一块由你（agent）驱动的终端 UI 画布。人类通过底部输入框与你对话，也会直接操作你渲染的界面。",
  "可用 MCP 工具：",
  "- vibetui_guide()：$ui 活对象树的编写规范与样例，画任何页面前先读它",
  "- vibetui_eval(code)：会话级 JS REPL；顶层变量、函数与闭包会跨调用保留，组件插入/删除/props 热换/监听每步立即上屏",
  "- vibetui_snapshot()：查看当前画布字符画",
  '界面事件会以 "[page] ..." 开头的消息回流给你（按钮点击等）；$ui 的 handler 里可直接调用 $agent.send(text, payload?)。',
  "现在：先调用 vibetui_guide 学习规范，然后为当前对话场景搭建初始界面（一个组件一个组件地搭，人类能看到页面逐步长出来）；若没有明确场景，渲染一个简洁的欢迎页（标题 + 一句能力介绍 + 几个引导按钮，按钮回调用 $agent.send 把用户意图回流给你）。",
].join("\n")

/** vibetui_guide 工具返回的内容：$ui 精简规范 + 可直接照抄的黄金样例 */
export const LIVE_GUIDE = `# vibe-tui $ui 活对象树速成

画布是一棵活组件树，你用 vibetui_eval 在会话级真 JS REPL 中操作它，每步立即上屏、立即可交互。
不写 JSON schema、不写 "{{ }}" 表达式字符串——回调就是真函数。

## REPL 语义
- 同一 vibe-tui 会话内，顶层 const / let / var、函数和闭包跨多次 vibetui_eval 保留。
  例如先执行 \`const actions = { inc: () => ++$ui.data.count }\`，下一次可直接执行 \`actions.inc()\`。
- \`$ui\` 与 \`$agent\` 是固定宿主入口；可操作其对象，但不要给它们重新赋值。
- 顶层 \`const\` / \`let\` 不能重复声明，和普通 JS REPL 一样。一次性 helper 用 const；
  需要在重新搭页时反复初始化的绑定可用 var（允许重复声明），或改为给既有 let 赋值。
- UI 的响应式用户状态仍应放 \`$ui.data\`；REPL 变量适合 actions、格式化函数和临时节点引用。

## 基本操作
- 设页面：$ui.page({ title: "标题", description: "副标题", mode: "interactive" | "form" })
- 加组件：$ui.add("组件名", { id?, content?, name?, default?, props? }) → 返回节点，可继续 .add 嵌套
  节点.add(...) 加子节点；$ui.insert(index, "组件名", {...}) 定位插入
  无 content、name、props 等配置时可直接写 $ui.add("Space") 或 node.add("Row")，无需传 {}。
- 组件名：Button / Card / Flex / Row / Col / Space / Input / TextArea / InputNumber / Select /
  Checkbox / Checkbox.Group / Radio.Group / Switch / Slider / Typography.Text / FormItem /
  Alert / Tag / Divider / Progress / Statistic / Descriptions / Spin / Table
  未知组件名与未知 props 键会立即抛错，按错误信息里的可用列表修
- Flex：antd Flex 语义，props 可用 vertical / gap / justify / align / wrap / flex / style；
  终端滚动内容区用 tuiScroll: true（TUI 扩展）。
- 栅格：用 Row + Col，不要把 Input/Button 直接并排放进 Row。Row 的 gutter / align / justify / wrap
  与 antd 同名；Col 用 flex: 1 均分、span: 12 占半行、offset 留空。Input / TextArea 的 style
  可传 width 或 flex；紧凑搜索栏可写：
  \`var row = $ui.add("Row", { props: { gutter: 1, align: "middle" } });
   row.add("Col", { props: { flex: 1 } }).add("Input", { name: "query", props: { placeholder: "搜索" } });
   row.add("Col").add("Button", { content: "搜索", props: { tuiOnClick: () => $agent.send("search", $ui.data.query) } })\`
- 文案用 content（Button 文案、Typography.Text 文本）
- props 值可以是真函数：{ tuiOnClick: () => $agent.send('run') }；禁止 "{{ }}" 字符串
- Input 的 \`tuiOnPressEnter\` 是“输入框内按 Enter”事件（终端没有 DOM event 参数，故用 tui 前缀）；
  它与 Button 的 \`tuiHotkey: "enter"\` 无关，输入框聚焦时按钮热键不会触发。
- 修改即刻生效：$ui.get(id).props.percent = 60、$ui.get(id).content = "新文案"、
  $ui.get(id).remove()、节点.moveTo(target, index?)

## 数据与联动
- $ui.data：响应式数据域。输入组件用 name 双向绑定（Input/Select/Checkbox/Slider...）；
  Typography.Text 用 name 单向显示 String($ui.data[name])；default 写入初值（不覆盖已有键）
- 逻辑里直接读写 $ui.data.xxx；$ui.watch(() => $ui.data.x, (v) => { ... }) 动态监听，返回 disposer
- handler 是真闭包，可直接用 $agent.send / $ui / REPL 中已声明的函数；
  例如 \`const actions = { submit: () => $agent.send("submit", $ui.data) }\` 后，后续 eval 和按钮回调都可用 \`actions.submit\`

## 退出语义
- $ui.clear()：清空整页（换页/重建前先 clear）
- Esc 行为默认与页面模式一致（interactive 完成回传 $ui.data、form 取消）；
  $ui.escape(fn) 覆盖、$ui.escape(null) 去除、$ui.escape() 恢复默认

## 事件回流
- $agent.send(text, payload?)：把事件/数据推给你，人类操作界面时你会收到 "[page] ..." 消息

## 黄金样例（计数器，逐段执行每步都即时上屏）
$ui.page({ title: "计数器", mode: "interactive" })
$ui.add("Statistic", { id: "stat", props: { title: "当前计数", value: 0 } })
var row = $ui.add("Space", { props: { size: 2 } })
row.add("Button", { content: "+1", props: { tuiSize: "small", tuiHotkey: "+",
  tuiOnClick: () => { $ui.data.count = ($ui.data.count ?? 0) + 1; $ui.get("stat").props.value = $ui.data.count } } })
row.add("Button", { content: "上报", props: { tuiSize: "small",
  tuiOnClick: () => $agent.send("count", $ui.data.count) } })

搭完调 vibetui_snapshot 自查布局；操作报错时按错误信息里的可用组件/props 修。`
