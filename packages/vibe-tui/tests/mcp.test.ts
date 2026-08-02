import { describe, expect, test } from "bun:test"
import { startMcpCanvasServer, type CanvasBridge } from "../src/mcp"
import { createEvalRepl } from "../src/eval"

/**
 * MCP 画布服务：以 Streamable HTTP 客户端视角直连，
 * 验证 tools/list 与四个工具的调用协议（不经 agent）。
 */

function fakeBridge(): CanvasBridge {
  const data: Record<string, unknown> = { count: 1 }
  const ui = { data }
  const repl = createEvalRepl({ $ui: ui })
  return {
    evaluate: (code) => repl.evaluate(code),
    snapshot: async () => "PAGE_FRAME",
    hostSnapshot: () => "HOST_FRAME",
    guide: () => "GUIDE",
    example: () => "EXAMPLE",
    layout: () => ({ viewport: { width: 80, height: 20 }, warnings: [] }),
    inspect: (id) => ({ id: id ?? "all", text: { content: "children" } }),
    reset: () => ({ cleared: true, scopeReset: true }),
    dispatch: (id, event, value) => ({ id, event, value, callbackCalled: true }),
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
  test("tools/list 暴露画布工具", async () => {
    const server = await startMcpCanvasServer(fakeBridge())
    await initSession(server.url)
    const resp = await rpc(server.url, { id: 1, method: "tools/list", params: {} })
    const names = ((resp.result as { tools: Array<{ name: string }> }).tools ?? []).map(
      (t) => t.name,
    )
    expect(names.sort()).toEqual([
      "vibetui_dispatch",
      "vibetui_eval",
      "vibetui_example",
      "vibetui_guide",
      "vibetui_host_snapshot",
      "vibetui_inspect",
      "vibetui_layout",
      "vibetui_reset",
      "vibetui_snapshot",
    ])
    server.close()
  })

  test("eval 读写 $ui.data；页面/宿主快照与 guide 各自透传", async () => {
    const server = await startMcpCanvasServer(fakeBridge())
    await initSession(server.url)

    // eval 写后读：与画布同一 $ui 作用域
    await rpc(server.url, {
      id: 2,
      method: "tools/call",
      params: { name: "vibetui_eval", arguments: { code: "$ui.data.count = 41 + 1" } },
    })
    const read = await rpc(server.url, {
      id: 3,
      method: "tools/call",
      params: { name: "vibetui_eval", arguments: { code: "$ui.data.count" } },
    })
    expect(toolText(read)).toBe("42")

    const snap = await rpc(server.url, {
      id: 4,
      method: "tools/call",
      params: { name: "vibetui_snapshot", arguments: {} },
    })
    expect(toolText(snap)).toBe("PAGE_FRAME")

    const hostSnap = await rpc(server.url, {
      id: 5,
      method: "tools/call",
      params: { name: "vibetui_host_snapshot", arguments: {} },
    })
    expect(toolText(hostSnap)).toBe("HOST_FRAME")

    const layout = await rpc(server.url, {
      id: 6,
      method: "tools/call",
      params: { name: "vibetui_layout", arguments: {} },
    })
    expect(JSON.parse(toolText(layout))).toEqual({ viewport: { width: 80, height: 20 }, warnings: [] })

    const inspect = await rpc(server.url, {
      id: 7,
      method: "tools/call",
      params: { name: "vibetui_inspect", arguments: { id: "alert" } },
    })
    expect(JSON.parse(toolText(inspect))).toEqual({ id: "alert", text: { content: "children" } })

    const reset = await rpc(server.url, {
      id: 8,
      method: "tools/call",
      params: { name: "vibetui_reset", arguments: {} },
    })
    expect(JSON.parse(toolText(reset))).toEqual({ cleared: true, scopeReset: true })

    const dispatch = await rpc(server.url, {
      id: 9,
      method: "tools/call",
      params: { name: "vibetui_dispatch", arguments: { id: "query", event: "change", value: "antd" } },
    })
    expect(JSON.parse(toolText(dispatch))).toEqual({
      id: "query",
      event: "change",
      value: "antd",
      callbackCalled: true,
    })

    const guide = await rpc(server.url, {
      id: 10,
      method: "tools/call",
      params: { name: "vibetui_guide", arguments: {} },
    })
    expect(toolText(guide)).toBe("GUIDE")

    const example = await rpc(server.url, {
      id: 8,
      method: "tools/call",
      params: { name: "vibetui_example", arguments: {} },
    })
    expect(toolText(example)).toBe("EXAMPLE")
    server.close()
  })
})
