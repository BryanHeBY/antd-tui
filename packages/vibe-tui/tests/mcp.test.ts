import { describe, expect, test } from "bun:test"
import { startMcpCanvasServer, type CanvasBridge } from "../src/mcp"
import { evalInScope } from "../src/eval"

/**
 * MCP 画布服务：以 Streamable HTTP 客户端视角直连，
 * 验证 tools/list 与四个工具的调用协议(不经 agent)。
 */

function fakeBridge(): { bridge: CanvasBridge; rendered: unknown[] } {
  const rendered: unknown[] = []
  const state: Record<string, unknown> = { count: 1 }
  return {
    rendered,
    bridge: {
      render: (schema) => {
        if ((schema as { bad?: boolean }).bad) return { ok: false, errors: ["/form 必须是对象"] }
        rendered.push(schema)
        return { ok: true }
      },
      evaluate: (code) => evalInScope(code, { $state: state }),
      snapshot: () => "FRAME",
      guide: () => "GUIDE",
    },
  }
}

async function rpc(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
  })
  const text = await res.text()
  // Streamable HTTP 可能回 SSE 帧，取其中 data 行
  const dataLine = text
    .split("\n")
    .find((l) => l.startsWith("data:"))
  const payload = dataLine ? dataLine.slice(5).trim() : text
  return JSON.parse(payload) as Record<string, unknown>
}

async function initSession(url: string): Promise<void> {
  await rpc(url, {
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
  })
}

function toolText(resp: Record<string, unknown>): string {
  const result = resp.result as { content?: Array<{ text?: string }> }
  return result?.content?.[0]?.text ?? ""
}

describe("MCP 画布服务", () => {
  test("tools/list 暴露四个工具", async () => {
    const { bridge } = fakeBridge()
    const server = await startMcpCanvasServer(bridge)
    await initSession(server.url)
    const resp = await rpc(server.url, { id: 1, method: "tools/list", params: {} })
    const names = ((resp.result as { tools: Array<{ name: string }> }).tools ?? []).map(
      (t) => t.name,
    )
    expect(names.sort()).toEqual([
      "vibetui_eval",
      "vibetui_guide",
      "vibetui_render",
      "vibetui_snapshot",
    ])
    server.close()
  })

  test("render 成功与校验失败；eval 读写；guide/snapshot 透传", async () => {
    const { bridge, rendered } = fakeBridge()
    const server = await startMcpCanvasServer(bridge)
    await initSession(server.url)

    const ok = await rpc(server.url, {
      id: 2,
      method: "tools/call",
      params: { name: "vibetui_render", arguments: { schema: { version: "0.1" } } },
    })
    expect(toolText(ok)).toContain("已渲染")
    expect(rendered.length).toBe(1)

    const bad = await rpc(server.url, {
      id: 3,
      method: "tools/call",
      params: { name: "vibetui_render", arguments: { schema: { bad: true } } },
    })
    expect(toolText(bad)).toContain("/form 必须是对象")

    // eval 写后读：与页面表达式同一作用域
    await rpc(server.url, {
      id: 4,
      method: "tools/call",
      params: { name: "vibetui_eval", arguments: { code: "$state.count = 41 + 1" } },
    })
    const read = await rpc(server.url, {
      id: 5,
      method: "tools/call",
      params: { name: "vibetui_eval", arguments: { code: "$state.count" } },
    })
    expect(toolText(read)).toBe("42")

    const snap = await rpc(server.url, {
      id: 6,
      method: "tools/call",
      params: { name: "vibetui_snapshot", arguments: {} },
    })
    expect(toolText(snap)).toBe("FRAME")

    const guide = await rpc(server.url, {
      id: 7,
      method: "tools/call",
      params: { name: "vibetui_guide", arguments: {} },
    })
    expect(toolText(guide)).toBe("GUIDE")
    server.close()
  })
})
