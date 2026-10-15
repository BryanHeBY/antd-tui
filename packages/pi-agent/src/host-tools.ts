/**
 * 宿主工具抽象层：一套 HostToolSpec，两张注册面。
 *
 * - pi 原生后端：toAgentTools() 直接转成进程内 AgentTool（typebox 参数原样使用）
 * - ACP 后端：startMcpToolServer() 起进程内 MCP HTTP（Streamable HTTP 无状态模式），
 *   经 session/new 的 mcpServers 注入外部 agent——工具始终执行在宿主进程内
 *
 * 参数 schema 以 typebox 为单一事实源；MCP 面需要 zod raw shape，这里做一个
 * 有意收窄的单向映射（string/integer/enum/unknown + optional），超出子集立即抛错。
 * 两面的执行语义对齐：run 抛错 = isError 工具结果，成功返回 JSON 序列化文本。
 */
import { createServer, type Server } from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z, type ZodType } from "zod"
import type { TObject } from "typebox"
import type { AgentTool } from "@earendil-works/pi-agent-core"

export interface HostToolSpec<I = Record<string, unknown>> {
  /** 稳定工具名（如 "ansh_exec"）；MCP 面与 pi 面同名同义 */
  name: string
  /** agent 读的说明；两张注册面共享一份 */
  description: string
  /** typebox 参数 schema */
  parameters: TObject
  /** 纯函数：抛错 = 工具错误；返回值 JSON 序列化后回给 agent */
  run: (input: I) => unknown | Promise<unknown>
}

/** 容器用的宽类型：run 参数逆变，任何具态 spec 都可装入 */
export type AnyHostToolSpec = HostToolSpec<never>

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "undefined"
  } catch {
    return String(value)
  }
}

/** typebox 字段 → zod 字段；只接受收窄子集，越界即抛错（编译产物不该带惊喜） */
function toZodField(name: string, schema: Record<string, unknown>): ZodType {
  const description = typeof schema.description === "string" ? schema.description : undefined
  let field: ZodType
  if (Array.isArray(schema.enum)) {
    field = z.enum(schema.enum as [string, ...string[]])
  } else if (schema.type === "string") {
    field = z.string()
  } else if (schema.type === "integer" || schema.type === "number") {
    field = z.number()
  } else if (schema.type === undefined) {
    // Type.Unknown：接受任意值（如 change 事件的 value）
    field = z.unknown()
  } else {
    throw new Error(`工具参数 ${name} 的类型不在支持子集内（string/integer/enum/unknown）`)
  }
  return description ? field.describe(description) : field
}

function toZodShape(parameters: TObject): Record<string, ZodType> {
  const required = new Set((parameters.required as string[] | undefined) ?? [])
  const shape: Record<string, ZodType> = {}
  for (const [name, schema] of Object.entries(parameters.properties ?? {})) {
    const field = toZodField(name, schema as Record<string, unknown>)
    shape[name] = required.has(name) ? field : field.optional()
  }
  return shape
}

/** pi 注册面：HostToolSpec → 进程内 AgentTool（typebox 参数原样透传） */
export function toAgentTools(specs: AnyHostToolSpec[]): AgentTool[] {
  return specs.map((spec) => ({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    execute: async (_id, params) => ({
      content: [{ type: "text" as const, text: serialize(await spec.run(params as never)) }],
      details: {},
    }),
  }))
}

function buildMcpServer(serverName: string, specs: AnyHostToolSpec[]): McpServer {
  const server = new McpServer({ name: serverName, version: "0.1.0" })
  for (const spec of specs) {
    server.registerTool(
      spec.name,
      { description: spec.description, inputSchema: toZodShape(spec.parameters) },
      async (args) => {
        try {
          return { content: [{ type: "text" as const, text: serialize(await spec.run(args as never)) }] }
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `工具执行失败：${(err as Error).message}` }],
            isError: true,
          }
        }
      },
    )
  }
  return server
}

export interface McpToolServer {
  url: string
  close: () => void
}

/** ACP 注册面：进程内 MCP HTTP（随机端口、无状态模式），供 mcpServers 注入 */
export async function startMcpToolServer(serverName: string, specs: AnyHostToolSpec[]): Promise<McpToolServer> {
  // 接线期就校验全部 schema：不支持的参数形状当场失败，不留到首个请求
  for (const spec of specs) toZodShape(spec.parameters)
  const httpServer: Server = createServer((req, res) => {
    void (async () => {
      const server = buildMcpServer(serverName, specs)
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
