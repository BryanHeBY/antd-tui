/**
 * vibe-tui 内置 MCP 服务：把画布能力暴露成标准 MCP 工具，
 * 任意支持 MCP 的 agent（经 ACP session/new 的 mcpServers 注入）都能直接生成/操作界面。
 *
 * 工具集（最小完备闭环）：
 *   vibetui_render(schema)  —— 全量渲染/换页，校验失败返回带 JSON 路径的 errors
 *   vibetui_eval(code)      —— 页面上下文求值（$form/$state/$memo + scope 函数），读写数据不换页
 *   vibetui_snapshot()      —— 当前画布字符画（所见即人类所见）
 *   vibetui_guide()         —— schema 编写规范与样例（冷启动知识）
 *
 * 形态：进程内 HTTP（Streamable HTTP，无状态模式），随机端口。
 */
import { createServer, type Server } from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"

/** 画布桥：由 VibeApp 提供，工具经它触达活页面 */
export interface CanvasBridge {
  render: (schema: unknown) => { ok: boolean; errors?: string[] }
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
    "vibetui_render",
    {
      description:
        "渲染/替换 vibe-tui 画布页面。入参是 antd-tui 页面 Schema(JSON)。校验失败会返回带 JSON 路径的错误列表,按路径修复后重试。先调 vibetui_guide 学习 Schema 写法。",
      inputSchema: { schema: z.record(z.string(), z.unknown()).describe("antd-tui 页面 Schema") },
    },
    ({ schema }) => {
      const result = bridge.render(schema)
      if (!result.ok) {
        return textResult(`schema 校验失败:\n${(result.errors ?? []).join("\n")}`, true)
      }
      return textResult("已渲染。可调 vibetui_snapshot 查看效果。")
    },
  )

  server.registerTool(
    "vibetui_eval",
    {
      description:
        "在当前页面上下文执行 JS 并返回结果。作用域:$ui(活组件树,推荐)——真 JS 对象+真函数,每步操作立即校验并上屏:$ui.add(\"Button\", { content: \"跑\", props: { tuiOnClick: () => $agent.send('run') } }),$ui.get(id).props 热换、$ui.data 数据域、$ui.watch 监听;$schema(schema 草稿实时代理,配合 vibetui_render 的 schema 通路用,每次赋值/删除立即校验并上屏);schema 页在场时还有 $form/$state/$memo 与页面 scope 函数。注意两条通路最后写者胜,同一页面别混用。",
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
      description: "获取 antd-tui 页面 Schema 的编写规范与黄金样例。生成任何页面前先读它。",
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
