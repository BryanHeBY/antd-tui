import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildPiRuntime, loadAgentConfig, resolveConfigPath, WORKSPACE_CONFIG } from "../src/pi-config"
let dir: string | null = null

function fixture(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "antd-tui-pi-config-"))
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, content, "utf-8")
  }
  return dir
}

afterEach(() => {
  delete process.env.PI_MODEL
  delete process.env.PI_EFFORT
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = null
  }
})

describe("loadAgentConfig", () => {
  test("解析 model/effort/authFile/providers 并容忍可选段缺省", () => {
    const root = fixture({
      "agent.json": JSON.stringify({
        model: "openrouter/qwen3-coder",
        effort: "high",
        authFile: "~/pi-auth.json",
        providers: { openrouter: { baseUrl: "https://openrouter.ai/api/v1", wireApi: "chat" } },
      }),
    })
    const config = loadAgentConfig(join(root, "agent.json"))
    expect(config.model).toBe("openrouter/qwen3-coder")
    expect(config.effort).toBe("high")
    expect(config.authFile).toBe("~/pi-auth.json")
    expect(config.providers?.openrouter?.wireApi).toBe("chat")
  })

  test("文件不存在与坏 JSON 报配置错误", () => {
    const root = fixture({ "other.json": "{}" })
    expect(() => loadAgentConfig(join(root, "agent.json"))).toThrow("读取配置文件")
    const bad = fixture({ "bad.json": "{nope" })
    expect(() => loadAgentConfig(join(bad, "bad.json"))).toThrow("读取配置文件")
  })

  test("坏凭据判别式立即报错", () => {
    const root = fixture({
      "agent.json": JSON.stringify({ auth: { openai: { type: "api_key", key: 42 } } }),
    })
    expect(() => loadAgentConfig(join(root, "agent.json"))).toThrow("openai")
  })

  test("自定义 provider 缺 baseUrl 报错", () => {
    const root = fixture({ "agent.json": JSON.stringify({ providers: { x: {} } }) })
    expect(() => loadAgentConfig(join(root, "agent.json"))).toThrow("baseUrl")
  })
})

describe("buildPiRuntime", () => {
  test("内置 provider 直接解析；effort 优先级 flag > env > 配置", () => {
    const root = fixture({
      "agent.json": JSON.stringify({ model: "anthropic/claude-sonnet-4-5", effort: "low" }),
    })
    const byFlag = buildPiRuntime({ configPath: join(root, "agent.json"), effort: "high" })
    expect(byFlag.spec).toBe("anthropic/claude-sonnet-4-5")
    expect(byFlag.thinkingLevel).toBe("high")

    process.env.PI_EFFORT = "medium"
    expect(buildPiRuntime({ configPath: join(root, "agent.json") }).thinkingLevel).toBe("medium")

    delete process.env.PI_EFFORT
    expect(buildPiRuntime({ configPath: join(root, "agent.json") }).thinkingLevel).toBe("low")
  })
  test("模型优先级 --model > PI_MODEL > 配置文件", () => {
    const root = fixture({ "agent.json": JSON.stringify({ model: "openai/gpt-4.1" }) })
    expect(buildPiRuntime({ configPath: join(root, "agent.json") }).spec).toBe("openai/gpt-4.1")
    process.env.PI_MODEL = "openai/gpt-4.1-mini"
    expect(buildPiRuntime({ configPath: join(root, "agent.json") }).spec).toBe("openai/gpt-4.1-mini")
    expect(
      buildPiRuntime({ configPath: join(root, "agent.json"), model: "openai/gpt-4o" }).spec,
    ).toBe("openai/gpt-4o")
  })
  test("一个模型来源都没有时报错；工作区 agent.json 存在时自动采用", () => {
    // 裸 buildPiRuntime 会自动采用当前目录的 agent.json——切到空临时目录隔离仓库根的真实配置
    const previousCwd = process.cwd()
    const empty = fixture({})
    process.chdir(empty)
    try {
      expect(() => buildPiRuntime()).toThrow("--model")
    } finally {
      process.chdir(previousCwd)
    }
  })

  test("未给 configPath 时自动采用当前目录 agent.json", () => {
    const root = fixture({ "agent.json": JSON.stringify({ model: "openai/gpt-4.1" }) })
    const previousCwd = process.cwd()
    process.chdir(root)
    try {
      expect(resolveConfigPath()).toBe(WORKSPACE_CONFIG)
      expect(buildPiRuntime().spec).toBe("openai/gpt-4.1")
    } finally {
      process.chdir(previousCwd)
    }
  })
  test("自定义 OpenAI 兼容端点按 spec 的 model 段注册", () => {
    const root = fixture({
      "agent.json": JSON.stringify({
        model: "ollama/qwen3:32b",
        providers: { ollama: { baseUrl: "http://localhost:11434/v1", wireApi: "chat" } },
      }),
    })
    const runtime = buildPiRuntime({ configPath: join(root, "agent.json") })
    expect(runtime.spec).toBe("ollama/qwen3:32b")
    expect(runtime.models.getModel("ollama", "qwen3:32b")?.baseUrl).toBe("http://localhost:11434/v1")
  })

  test("spec 的 provider 未定义且非内置时报错提示 providers 段", () => {
    const root = fixture({ "agent.json": JSON.stringify({ model: "nope/x" }) })
    expect(() => buildPiRuntime({ configPath: join(root, "agent.json") })).toThrow("providers")
  })

  test("authFile 凭据可读，内嵌 auth 同 provider 覆盖；logout 只写回 authFile 来源", async () => {
    // 先建目录（fixture 返回后才能知道路径），再写引用该路径的 agent.json
    const root = fixture({
      "pi-auth.json": JSON.stringify({
        openai: { type: "api_key", key: "from-file" },
        anthropic: { type: "api_key", key: "file-too" },
      }),
    })
    writeFileSync(
      join(root, "agent.json"),
      JSON.stringify({
        model: "openai/gpt-4.1",
        authFile: join(root, "pi-auth.json"),
        auth: { openai: { type: "api_key", key: "inline-wins" } },
      }),
      "utf-8",
    )
    const runtime = buildPiRuntime({ configPath: join(root, "agent.json") })

    // 内嵌 auth 覆盖 authFile 的同 provider 条目；authFile 独有 provider 照常可解析
    const openaiAuth = (await runtime.models.getAuth("openai"))?.auth as Record<string, unknown>
    expect(openaiAuth).toMatchObject({ apiKey: "inline-wins" })
    expect(await runtime.models.getAuth("anthropic")).toBeDefined()

    // 两条凭据都源于 authFile：logout 写回原文件
    await runtime.models.logout("anthropic")
    expect(readFileSync(join(root, "pi-auth.json"), "utf-8")).not.toContain('"anthropic"')
    await runtime.models.logout("openai")
    expect(readFileSync(join(root, "pi-auth.json"), "utf-8")).not.toContain('"openai"')
  })


  test("纯内嵌凭据的 logout 不写任何文件", async () => {
    const root = fixture({
      "agent.json": JSON.stringify({
        model: "openai/gpt-4.1",
        auth: { openai: { type: "api_key", key: "inline-only" } },
      }),
    })
    const runtime = buildPiRuntime({ configPath: join(root, "agent.json") })
    await runtime.models.logout("openai")
    // agent.json 原样：内嵌凭据只在进程内生效，绝不改写配置文件
    const config = loadAgentConfig(join(root, "agent.json"))
    expect(config.auth?.openai).toBeDefined()
  })
})
