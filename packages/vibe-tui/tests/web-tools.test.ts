import { describe, expect, test } from "bun:test"
import { parseDdgResults, webTools } from "../src/web-tools"

const DDG_FIXTURE = `
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc">Example <b>A</b></a>
  </h2>
  <a class="result__snippet" href="...">第一条 摘要 &amp; 细节</a>
</div>
<div class="result">
  <a class="result__a" href="https://direct.example.org/b">直接链接 B</a>
  <a class="result__snippet">第二条摘要</a>
</div>
<div class="result--ad">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fad.example%2F&amp;rut=x">广告</a>
</div>
`

function find(tools: ReturnType<typeof webTools>, name: string) {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`missing ${name}`)
  return tool as unknown as { run: (input: Record<string, unknown>) => Promise<unknown> }
}
function fakeResponse(text: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => text } as unknown as Response
}


describe("parseDdgResults", () => {
  test("解码 uddg 跳转、剥内联标签、保留直链；无 snippet 的条目留空", () => {
    const results = parseDdgResults(DDG_FIXTURE)
    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({
      title: "Example A",
      url: "https://example.com/a",
      snippet: "第一条 摘要 & 细节",
    })
    expect(results[1]!.url).toBe("https://direct.example.org/b")
    expect(results[2]!.snippet).toBe("")
  })
})

describe("webTools", () => {
  test("web_search 解析并截断条数", async () => {
    const tools = webTools(async () => fakeResponse(DDG_FIXTURE))
    const result = (await find(tools, "web_search").run({ query: "x", limit: 2 })) as {
      results: unknown[]
    }
    expect(result.results).toHaveLength(2)
  })

  test("web_search 无结果时报错指引", async () => {
    const tools = webTools(async () => fakeResponse("<html></html>"))
    await expect(find(tools, "web_search").run({ query: "x" })).rejects.toThrow("没有解析到搜索结果")
  })

  test("web_read 截断并给 totalChars；reader 失败回退裸抓取剥标签", async () => {
    const long = "A".repeat(9_000)
    const tools = webTools(async (url) =>
      url.startsWith("https://r.jina.ai/")
        ? fakeResponse(long)
        : fakeResponse("<script>var x=1</script><style>a{}</style><p>fallback &amp; text</p>"),
    )
    const read = (await find(tools, "web_read").run({ url: "https://example.com/x" })) as {
      content: string
      truncated: boolean
      totalChars: number
    }
    expect(read.content.length).toBe(8_000)
    expect(read.truncated).toBe(true)
    expect(read.totalChars).toBe(9_000)

    const failThenFallback = webTools(async (url) =>
      url.startsWith("https://r.jina.ai/") ? fakeResponse("", false, 503) : fakeResponse("<p>raw page</p>"),
    )
    const fallback = (await find(failThenFallback, "web_read").run({ url: "https://example.com/y" })) as {
      content: string
    }
    expect(fallback.content).toContain("raw page")
  })

  test("web_read 拒绝非 http(s) URL", async () => {
    const tools = webTools(async () => fakeResponse(""))
    await expect(find(tools, "web_read").run({ url: "file:///etc/passwd" })).rejects.toThrow("http://")
  })
})

describe("webTools 真网络冒烟（依赖代理环境，失败不阻塞 CI 语义）", () => {
  test("DDG 真请求解析出结果", async () => {
    const tools = webTools()
    const result = (await find(tools, "web_search").run({ query: "opentui" })) as {
      results: Array<{ url: string }>
    }
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results[0]!.url).toMatch(/^https?:\/\//)
  }, 25000)
})
