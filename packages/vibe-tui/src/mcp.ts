/**
 * vibe-tui 内置 MCP 服务：把画布能力暴露成标准 MCP 工具，
 * 任意支持 MCP 的 agent（经 ACP session/new 的 mcpServers 注入）都能直接生成/操作界面。
 *
 * 工具集（最小完备闭环）：
 *   vibetui_eval(code)      —— 在 $ui 活对象树上执行 JS（真对象+真函数）；即时变更、非事务
 *   vibetui_snapshot()      —— 等待绘制完成后获取 agent 页面字符画（不受宿主覆盖层影响）
 *   vibetui_host_snapshot() —— 获取当前宿主终端字符画（含日志/状态栏等覆盖层）
 *   vibetui_layout()        —— 查看当前 Row / Col 配置、画布尺寸与确定的换行风险
 *   vibetui_guide()         —— $ui 编写规范与样例（冷启动知识）
 *
 * 形态：进程内 HTTP（Streamable HTTP，无状态模式），随机端口。
 */
import { createServer, type Server } from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"

/** 画布桥：由 VibeApp 提供，工具经它触达活页面 */
export interface CanvasBridge {
  evaluate: (code: string) => unknown
  /** agent 页面视觉快照；允许等待下一次渲染完成。 */
  snapshot: () => string | Promise<string>
  /** 当前宿主画面，用于诊断 F3 日志层等宿主状态。 */
  hostSnapshot: () => string | Promise<string>
  guide: () => string
  /** dashboard 参考实现全文(含 vibe 适配说明) */
  example: () => string
  /** 当前活树可静态判定的布局配置与风险；不是伪造的渲染几何测量。 */
  layout: () => unknown
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError }
}

function buildServer(bridge: CanvasBridge): McpServer {
  const server = new McpServer({ name: "vibe-tui", version: "0.1.0" })

  server.registerTool(
    "vibetui_eval",
    {
      description:
        "在会话级 JS REPL 中操作 $ui 活组件树并返回结果——直接传完整 JS 程序即可（可声明函数、循环生成整页）；顶层变量、函数和闭包跨调用保留。常用：$ui.page({ title, mode }) 设页面；$ui.add(\"Button\", { content: \"跑\", props: { tuiOnClick: () => $agent.send('run') } }) 加组件（返回节点，可继续 .add 嵌套）；无配置的容器可直接 $ui.add(\"Space\")，无需 {}；$ui.get(id).props.xxx = 新值 热换；$ui.data 响应式数据域（输入组件经 name 绑定）；$ui.watch(getter, cb) 监听；$ui.clear() 清空重建。$ui 操作按语句即时校验并上屏；一次 eval 非事务，后续报错不会回滚此前已成功的修改。$ui.clear() 会清空树、页面元信息、数据和 watch，只用于有意重建。未知组件/props 立即抛错。先调 vibetui_guide 学习写法。",
      inputSchema: { code: z.string().describe("JS 表达式或语句体") },
    },
    ({ code }) => {
      try {
        const value = bridge.evaluate(code)
        let serialized: string
        try {
          serialized = JSON.stringify(value, null, 2) ?? "undefined"
        } catch {
          serialized = String(value)
        }
        return textResult(serialized)
      } catch (err) {
        return textResult(`执行失败:${(err as Error).message}`, true)
      }
    },
  )

  server.registerTool(
    "vibetui_layout",
    {
      description:
        "诊断当前页面的布局配置：返回画布字符格尺寸、Row/Col 的有效 span/flex/width/wrap/gutter，以及可确定的换行或 24 栅格溢出风险。它报告的是活树配置，不会伪造组件实际坐标；用 vibetui_snapshot 复核最终视觉结果。布局异常时先调用此工具，再修改 Row/Col。",
      inputSchema: {},
    },
    () => {
      try {
        return textResult(JSON.stringify(bridge.layout(), null, 2))
      } catch (err) {
        return textResult(`布局诊断失败:${(err as Error).message}`, true)
      }
    },
  )

  server.registerTool(
    "vibetui_snapshot",
    {
      description:
        "等待 $ui 页面绘制完成后，获取仅包含 agent 页面区域的字符画，用于视觉验收。它不受 F2 键盘模式、F3 对话记录、状态栏或输入框影响；若要诊断宿主当前可见画面，使用 vibetui_host_snapshot。",
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await bridge.snapshot())
      } catch (err) {
        return textResult(`截帧失败:${(err as Error).message}`, true)
      }
    },
  )

  server.registerTool(
    "vibetui_host_snapshot",
    {
      description: "获取人类当前终端所见的完整宿主画面，含 F3 对话记录、状态栏和输入框；用于诊断宿主层，不用于 $ui 页面视觉验收。",
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await bridge.hostSnapshot())
      } catch (err) {
        return textResult(`截帧失败:${(err as Error).message}`, true)
      }
    },
  )

  server.registerTool(
    "vibetui_guide",
    {
      description: "获取 $ui 活对象树的编写规范与黄金样例。生成任何页面前先读它。",
      inputSchema: {},
    },
    () => textResult(bridge.guide()),
  )

  server.registerTool(
    "vibetui_example",
    {
      description:
        "获取可直接交给 vibetui_eval 执行的 JavaScript App Shell 参考（满幅顶栏、侧栏导航、可滚动动态主区）。搭导航壳、多区域页面、表单或列表时按需调用；简单页面可直接写 JS。",
      inputSchema: {},
    },
    () => textResult(bridge.example()),
  )

  return server
}

export interface McpCanvasServer {
  url: string
  close: () => void
}

/**
 * 启动进程内 MCP HTTP 服务（随机端口，无状态模式：每个请求新建 transport，
 * 适配任意会话行为的 MCP 客户端）。
 */
export async function startMcpCanvasServer(bridge: CanvasBridge): Promise<McpCanvasServer> {
  const httpServer: Server = createServer((req, res) => {
    void (async () => {
      const server = buildServer(bridge)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on("close", () => {
        void transport.close()
        void server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res)
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(500).end()
      }
    })
  })

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve))
  const address = httpServer.address()
  const port = typeof address === "object" && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => httpServer.close(),
  }
}
