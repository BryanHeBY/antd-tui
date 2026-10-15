/**
 * 画布工具的单一事实源：名称、描述与参数语义。
 *
 * 两套注册面共用一份描述：
 * - MCP（mcp.ts）：zod inputSchema，经 HTTP 注入任意 ACP agent
 * - pi 原生后端（nativeCanvasTools）：typebox 参数，进程内直接调用 CanvasBridge，
 *   不经 MCP HTTP——全内存闭环
 */
import type { AgentTool } from "@antd-tui/pi-agent"
import { Type } from "@earendil-works/pi-ai"
import type { CanvasBridge } from "./mcp"

export const CANVAS_TOOL_DESCRIPTIONS = {
  eval:
    "在会话级 JS REPL 中操作 $ui 活组件树并返回结果——直接传完整 JS 程序即可（可声明函数、循环生成整页）；顶层变量、函数和闭包跨调用保留。常用：$ui.page({ title, mode }) 设页面；$ui.add(\"Button\", { content: \"跑\", props: { tuiOnClick: () => $agent.send('run') } }) 加组件（返回节点，可继续 .add 嵌套）；无配置的容器可直接 $ui.add(\"Space\")，无需 {}；$ui.get(id).props.xxx = 新值 热换；$ui.data 响应式数据域（输入组件经 name 绑定）；$ui.watch(getter, cb) 监听；$ui.clear() 清空重建。$ui 操作按语句即时校验并上屏；一次 eval 非事务，后续报错不会回滚此前已成功的修改。$ui.clear() 会清空树、页面元信息、数据和 watch，只用于有意重建。未知组件/props 立即抛错。先调 vibetui_guide 学习写法。",
  dispatch:
    "验证已构建页面的语义事件：click 调用节点 tuiOnClick，pressEnter 调用 tuiOnPressEnter，change 调用输入组件的 change handler，并同步 name 绑定的 $ui.data。它不会模拟真实鼠标坐标、焦点移动或键盘导航；需要那些渲染器级行为时仍应让人类操作并用 snapshot 验收。disabled/loading 节点不会被调用。这是自测演练：回调内的 $agent.send 与抛错都不会回流成新的 [page] 消息，结果只经本工具的返回值/错误同步返回，可放心反复验证。",
  reset:
    "明确重置整页迭代状态：清空 $ui 组件树、页面元信息、$ui.data 和 watch，同时丢弃 vibetui_eval 里声明的顶层 const/let/var、函数与闭包。普通 $ui.clear() 只清 UI，不重置 REPL；只有确定不再复用旧 helper/状态时才调用本工具。",
  inspect:
    "检查 $ui 节点的当前 props、content、子节点和文本槽位。传 id 时只检查该节点；省略 id 返回整棵树。尤其用于 Alert：主文案是 props.message，description 是次级说明，content 只是 children，不会替代 message。",
  layout:
    "诊断当前页面的布局配置：返回画布字符格尺寸、Row/Col 的有效 span/flex/width/wrap/gutter，以及可确定的换行或 24 栅格溢出风险。它报告的是活树配置，不会伪造组件实际坐标；用 vibetui_snapshot 复核最终视觉结果。布局异常时先调用此工具，再修改 Row/Col。",
  snapshot:
    "等待 $ui 页面绘制完成后，获取仅包含 agent 页面区域的字符画，用于视觉验收。它不受 F2 键盘模式、F3 对话记录、状态栏或输入框影响；若要诊断宿主当前可见画面，使用 vibetui_host_snapshot。",
  hostSnapshot:
    "获取人类当前终端所见的完整宿主画面，含 F3 对话记录、状态栏和输入框；用于诊断宿主层，不用于 $ui 页面视觉验收。",
  guide: "获取 $ui 活对象树的编写规范与黄金样例。生成任何页面前先读它。",
  example:
    "获取可直接交给 vibetui_eval 执行的 JavaScript App Shell 参考（满幅顶栏、侧栏导航、可滚动动态主区）。搭导航壳、多区域页面、表单或列表时按需调用；简单页面可直接写 JS。",
} as const

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "undefined"
  } catch {
    return String(value)
  }
}

/** pi 原生后端的画布工具：typebox 参数 + 进程内直调 CanvasBridge（无 MCP HTTP） */
export function nativeCanvasTools(bridge: CanvasBridge): AgentTool[] {
  return [
    {
      name: "vibetui_eval",
      label: "vibetui_eval",
      description: CANVAS_TOOL_DESCRIPTIONS.eval,
      parameters: Type.Object({ code: Type.String({ description: "JS 表达式或语句体" }) }),
      execute: async (_id, params) => ({
        content: [{ type: "text" as const, text: serialize(bridge.evaluate((params as { code: string }).code)) }],
        details: {},
      }),
    },
    {
      name: "vibetui_dispatch",
      label: "vibetui_dispatch",
      description: CANVAS_TOOL_DESCRIPTIONS.dispatch,
      parameters: Type.Object({
        id: Type.String({ description: "目标 $ui 节点 id" }),
        event: Type.Enum(
          { click: "click", pressEnter: "pressEnter", change: "change" },
          { description: "要验证的组件语义事件" },
        ),
        value: Type.Unknown({ description: "change 事件的新值；其他事件不需要" }),
      }),
      execute: async (_id, params) => {
        const args = params as { id: string; event: "click" | "pressEnter" | "change"; value?: unknown }
        return {
          content: [{ type: "text" as const, text: serialize(bridge.dispatch(args.id, args.event, args.value)) }],
          details: {},
        }
      },
    },
    {
      name: "vibetui_reset",
      label: "vibetui_reset",
      description: CANVAS_TOOL_DESCRIPTIONS.reset,
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text" as const, text: serialize(bridge.reset()) }], details: {} }),
    },
    {
      name: "vibetui_inspect",
      label: "vibetui_inspect",
      description: CANVAS_TOOL_DESCRIPTIONS.inspect,
      parameters: Type.Object({
        id: Type.Optional(Type.String({ description: "可选的 $ui 节点 id" })),
      }),
      execute: async (_id, params) => ({
        content: [{ type: "text" as const, text: serialize(bridge.inspect((params as { id?: string }).id)) }],
        details: {},
      }),
    },
    {
      name: "vibetui_layout",
      label: "vibetui_layout",
      description: CANVAS_TOOL_DESCRIPTIONS.layout,
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text" as const, text: serialize(bridge.layout()) }], details: {} }),
    },
    {
      name: "vibetui_snapshot",
      label: "vibetui_snapshot",
      description: CANVAS_TOOL_DESCRIPTIONS.snapshot,
      parameters: Type.Object({}),
      execute: async () => ({
        content: [{ type: "text" as const, text: await bridge.snapshot() }],
        details: {},
      }),
    },
    {
      name: "vibetui_host_snapshot",
      label: "vibetui_host_snapshot",
      description: CANVAS_TOOL_DESCRIPTIONS.hostSnapshot,
      parameters: Type.Object({}),
      execute: async () => ({
        content: [{ type: "text" as const, text: await bridge.hostSnapshot() }],
        details: {},
      }),
    },
    {
      name: "vibetui_guide",
      label: "vibetui_guide",
      description: CANVAS_TOOL_DESCRIPTIONS.guide,
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text" as const, text: bridge.guide() }], details: {} }),
    },
    {
      name: "vibetui_example",
      label: "vibetui_example",
      description: CANVAS_TOOL_DESCRIPTIONS.example,
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text" as const, text: bridge.example() }], details: {} }),
    },
  ]
}
