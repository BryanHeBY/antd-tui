import { describe, expect, test } from "bun:test"
import {
  compileAgentCommand,
  findModelOption,
  listCommands,
  matchCommands,
  parseSlash,
  type SlashContext,
} from "../src/commands"

const bare: SlashContext = {
  agentReady: false,
  support: null,
  modes: null,
  configOptions: [],
  agentCommands: [],
}

const full: SlashContext = {
  agentReady: true,
  support: {
    loadSession: true,
    listSessions: true,
    deleteSession: true,
    forkSession: false,
    resumeSession: false,
    closeSession: false,
    setMode: true,
    setConfigOption: true,
  },
  modes: { currentModeId: "chat", availableModes: [{ id: "chat", name: "对话" }] },
  configOptions: [
    {
      id: "model",
      name: "模型",
      category: "model",
      type: "select",
      currentValue: "fast",
      options: [{ value: "fast", name: "快速" }],
    },
  ],
  agentCommands: [{ name: "review", description: "审查改动", input: { hint: "<路径>" } }],
}

describe("parseSlash", () => {
  test("裸 / 也算命令，名字为空以便列出全部候选", () => {
    expect(parseSlash("/")).toEqual({ name: "", rest: "" })
  })

  test("拆出命令名与其后的原始参数", () => {
    expect(parseSlash("/session load abc ")).toEqual({ name: "session", rest: "load abc" })
  })

  test("首词含第二个 / 的一律留给 shell（绝对路径命令）", () => {
    expect(parseSlash("/usr/bin/ls")).toBeNull()
    expect(parseSlash("/tmp/x.sh -v")).toBeNull()
  })

  test("非斜杠开头不参与", () => {
    expect(parseSlash("echo /x")).toBeNull()
    expect(parseSlash("")).toBeNull()
  })

  test("前导空白不影响判定", () => {
    expect(parseSlash("  /help")).toEqual({ name: "help", rest: "" })
  })
})

describe("listCommands", () => {
  test("没有 agent 时只剩 /help", () => {
    expect(listCommands(bare).map((c) => c.name)).toEqual(["help"])
  })

  test("按 agent 声明的能力放行本地命令，并并入 agent 命令", () => {
    const names = listCommands(full).map((c) => c.name)
    expect(names).toContain("session")
    expect(names).toContain("mode")
    expect(names).toContain("model")
    expect(names).toContain("cancel")
    expect(names).toContain("permissions")
    expect(names).toContain("review")
    expect(listCommands(full).find((c) => c.name === "review")?.source).toBe("agent")
    expect(listCommands(full).find((c) => c.name === "review")?.hint).toBe("<路径>")
  })

  test("未声明 modes / 模型配置时不出现 /mode 与 /model", () => {
    const ctx: SlashContext = { ...full, modes: null, configOptions: [], support: { ...full.support!, setMode: false } }
    const names = listCommands(ctx).map((c) => c.name)
    expect(names).not.toContain("mode")
    expect(names).not.toContain("model")
  })

  test("agent 推来的同名命令不能劫持本地语义", () => {
    const ctx: SlashContext = {
      ...full,
      agentCommands: [{ name: "session", description: "agent 自己的 session" }],
    }
    const sessions = listCommands(ctx).filter((c) => c.name === "session")
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.source).toBe("local")
  })
})

describe("matchCommands", () => {
  test("按前缀过滤", () => {
    expect(matchCommands("/se", full).map((c) => c.name)).toEqual(["session"])
  })

  test("敲完命令名并带参数后只保留该命令（菜单不挡参数）", () => {
    expect(matchCommands("/session load x", full).map((c) => c.name)).toEqual(["session"])
  })

  test("非斜杠输入没有候选", () => {
    expect(matchCommands("echo hi", full)).toEqual([])
  })
})

describe("其它", () => {
  test("findModelOption 只认 category:model 的 select", () => {
    expect(findModelOption(full.configOptions)?.id).toBe("model")
    expect(findModelOption([])).toBeNull()
  })

  test("agent 命令编译回带斜杠的 prompt 文本", () => {
    expect(compileAgentCommand("review", "src")).toBe("/review src")
    expect(compileAgentCommand("explain", "")).toBe("/explain")
  })
})
