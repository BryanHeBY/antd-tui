/**
 * vibe-tui 内置 MCP 服务：把画布能力暴露成标准 MCP 工具，
 * 任意支持 MCP 的 agent（经 ACP session/new 的 mcpServers 注入）都能直接生成/操作界面。
 *
 * 工具集（最小完备闭环）：
 *   vibetui_eval(code)      —— 在 $ui 活对象树上执行 JS（真对象+真函数），每步立即上屏
 *   vibetui_snapshot()      —— 当前画布字符画（所见即人类所见）
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
  snapshot: () => string
  guide: () => string
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
        "在 $ui 活组件树上执行 JS 并返回结果——真 JS 对象+真函数，每步操作立即校验并上屏。常用：$ui.page({ title, mode }) 设页面；$ui.add(\"Button\", { content: \"跑\", props: { tuiOnClick: () => $agent.send('run') } }) 加组件（返回节点，可继续 .add 嵌套）；$ui.get(id).props.xxx = 新值 热换；$ui.data 响应式数据域（输入组件经 name 绑定）；$ui.watch(getter, cb) 监听；$ui.clear() 清空重建。未知组件/props 立即抛错。先调 vibetui_guide 学习写法。",
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
    "vibetui_snapshot",
    {
      description: "获取当前画布的字符画快照(与人类终端所见一致),用于确认渲染效果。",
      inputSchema: {},
    },
    () => {
      try {
        return textResult(bridge.snapshot())
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
