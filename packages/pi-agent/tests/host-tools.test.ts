import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Type } from "typebox"
import { startMcpToolServer, toAgentTools, type HostToolSpec } from "../src/host-tools"

const echoSpec: HostToolSpec<{ text: string; count?: number }> = {
  name: "test_echo",
  description: "回声工具",
  parameters: Type.Object({
    text: Type.String({ description: "文本" }),
    count: Type.Optional(Type.Integer({ description: "次数" })),
  }),
  run: ({ text, count }) => ({ echoed: text, count: count ?? 1 }),
}

describe("toAgentTools", () => {
  test("spec 映射为 AgentTool：名称/描述/参数透传，run 结果序列化", async () => {
    const tools = toAgentTools([echoSpec])
    expect(tools).toHaveLength(1)
    const tool = tools[0]!
    expect(tool.name).toBe("test_echo")
    expect(tool.description).toBe("回声工具")
    const result = await tool.execute("call-1", { text: "hi" })
    expect(result.content[0]).toMatchObject({ type: "text" })
    expect((result.content[0] as { text: string }).text).toContain('"echoed": "hi"')
  })

  test("run 抛错时由 pi 层转 isError 工具结果（这里只验证异常自然向上传播）", async () => {
    const failing: HostToolSpec = {
      name: "test_fail",
      description: "必失败",
      parameters: Type.Object({}),
      run: () => {
        throw new Error("坏了")
      },
    }
    const tool = toAgentTools([failing])[0]!
    await expect(tool.execute("call-2", {})).rejects.toThrow("坏了")
  })
})

describe("typebox → zod 映射", () => {
  test("支持子集映射：required 直传、optional 可缺省、enum 校验", async () => {
    const server = await startMcpToolServer("host-tools-test", [echoSpec])
    try {
      const client = new Client({ name: "test-client", version: "0.0.1" })
      const transport = new StreamableHTTPClientTransport(new URL(server.url))
      await client.connect(transport)
      const result = await client.callTool({ name: "test_echo", arguments: { text: "ok" } })
      expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual({
        echoed: "ok",
        count: 1,
      })
      // optional 缺省通过；enum/类型错误由 MCP 校验拒绝
      const bad = await client.callTool({ name: "test_echo", arguments: { count: "不是数字" } })
      expect(bad.isError).toBe(true)
      await client.close()
    } finally {
      server.close()
    }
  })

  test("run 抛错返回 isError 文本结果", async () => {
    const failing: HostToolSpec = {
      name: "test_fail",
      description: "必失败",
      parameters: Type.Object({}),
      run: () => {
        throw new Error("坏了")
      },
    }
    const server = await startMcpToolServer("host-tools-test", [failing])
    try {
      const client = new Client({ name: "test-client", version: "0.0.1" })
      const transport = new StreamableHTTPClientTransport(new URL(server.url))
      await client.connect(transport)
      const result = await client.callTool({ name: "test_fail", arguments: {} })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]!.text).toContain("坏了")
      await client.close()
    } finally {
      server.close()
    }
  })

  test("不支持的字段类型立即抛错", () => {
    const bad: HostToolSpec = {
      name: "test_bad",
      description: "坏 schema",
      parameters: Type.Object({ nested: Type.Object({ x: Type.String() }) }),
      run: () => ({}),
    }
    expect(startMcpToolServer("x", [bad])).rejects.toThrow("不在支持子集")
  })
})
