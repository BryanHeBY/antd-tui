/**
 * vibe-tui 的零 key 网页工具：搜索 + 阅读，走 HostToolSpec 双注册面
 * （pi 直调 / ACP 经进程内 MCP），与画布工具并列注入。
 *
 * 后端刻意零配置：
 * - web_search → DuckDuckGo HTML 端点（免 key；fetch 自动走 HTTPS_PROXY 环境代理）
 * - web_read   → r.jina.ai reader（免 key 基础档，返回干净 markdown）
 */
import { Type } from "typebox"
import type { HostToolSpec } from "@antd-tui/pi-agent"

const REQUEST_TIMEOUT_MS = 15_000
const SEARCH_DEFAULT_LIMIT = 5
const SEARCH_MAX_LIMIT = 10
const READ_DEFAULT_CHARS = 8_000
const READ_MAX_CHARS = 32_000

/** 注入面：测试传假 fetcher，生产用全局 fetch（Bun 自动吃 HTTPS_PROXY） */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** 常用 HTML 实体解码（DDG 结果标题/摘要里高频出现） */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
}

/** DDG 结果页 → [{title,url,snippet}]；纯函数，单独可测 */
export function parseDdgResults(html: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = []
  const anchors = [
    ...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
  ]
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
  for (let i = 0; i < anchors.length; i++) {
    const raw = anchors[i]![1]
    // DDG 的跳转链接：//duckduckgo.com/l/?uddg=<urlencoded>&rut=…；//协议相对补 https:；直链原样
    let url = raw.startsWith("//") ? `https:${raw}` : raw
    const uddg = /[?&]uddg=([^&]+)/.exec(url)
    if (uddg) url = decodeURIComponent(uddg[1]!)
    results.push({
      title: decodeEntities(anchors[i]![2].replace(/<[^>]+>/g, "").trim()),
      url,
      snippet: decodeEntities((snippets[i]?.[1] ?? "").replace(/<[^>]+>/g, "").trim()),
    })
  }
  return results
}

/** reader 不可达时的回退：裸抓取 + 剥标签（无 JS 渲染，聊胜于无） */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()
}

export function webTools(fetchImpl: FetchLike = fetch): HostToolSpec<never>[] {
  const searchSpec: HostToolSpec<{ query: string; limit?: number }> = {
    name: "web_search",
    description:
      "网页搜索（DuckDuckGo，免 key）。返回 [{ title, url, snippet }]，默认 5 条最多 10 条。先用它找来源，选中后用 web_read 读全文；snippet 通常足够判断相关性。",
    parameters: Type.Object({
      query: Type.String({ description: "搜索关键词" }),
      limit: Type.Optional(Type.Integer({ description: "返回条数，默认 5，最多 10" })),
    }),
    run: async ({ query, limit }) => {
      const cap = Math.max(1, Math.min(limit ?? SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT))
      const res = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`DuckDuckGo 返回 ${res.status}`)
      const results = parseDdgResults(await res.text()).slice(0, cap)
      if (results.length === 0) throw new Error("没有解析到搜索结果（换关键词或稍后重试）")
      return { query, results }
    },
  }

  const readSpec: HostToolSpec<{ url: string; maxChars?: number }> = {
    name: "web_read",
    description:
      "读取网页正文，返回干净的 markdown（r.jina.ai reader，免 key），默认截断 8000 字符、最多 32000。搜索结果里挑相关条目后用它读全文。",
    parameters: Type.Object({
      url: Type.String({ description: "完整 URL（含协议）" }),
      maxChars: Type.Optional(Type.Integer({ description: "最大字符数，默认 8000，最多 32000" })),
    }),
    run: async ({ url, maxChars }) => {
      if (!/^https?:\/\//.test(url)) throw new Error("URL 需以 http:// 或 https:// 开头")
      const cap = Math.max(200, Math.min(maxChars ?? READ_DEFAULT_CHARS, READ_MAX_CHARS))
      let text: string
      try {
        const res = await fetchImpl(`https://r.jina.ai/${url}`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`reader 返回 ${res.status}`)
        text = await res.text()
      } catch {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
        if (!res.ok) throw new Error(`页面返回 ${res.status}`)
        text = decodeEntities(stripTags(await res.text()))
      }
      const truncated = text.length > cap
      return {
        url,
        content: truncated ? text.slice(0, cap) : text,
        truncated,
        totalChars: text.length,
        note: truncated ? `已截断至 ${cap} 字符；需要更多可加大 maxChars 重读` : undefined,
      }
    },
  }

  return [searchSpec, readSpec] as HostToolSpec<never>[]
}
