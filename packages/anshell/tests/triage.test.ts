import { describe, expect, test } from "bun:test"
import { classifyInput, DEFAULT_OVERLAY_COMMANDS } from "../src/index"

const overlay = new Set(DEFAULT_OVERLAY_COMMANDS)
const inline = new Set(["fzf", "gitui"])

/** 传桩 which：只认这几个「存在的可执行」。 */
const which = (cmd: string) => ["ls", "git", "echo", "cat", "grep", "npm"].includes(cmd)

function triage(line: string) {
  return classifyInput(line, { which, overlay, inline })
}

describe("classifyInput", () => {
  test("overlay 集合 → interactive/overlay", () => {
    expect(triage("bash")).toMatchObject({ kind: "interactive", surface: "overlay" })
    expect(triage("vim foo.txt")).toMatchObject({ kind: "interactive", surface: "overlay" })
    expect(triage("htop")).toMatchObject({ kind: "interactive", surface: "overlay" })
    expect(triage("ssh host")).toMatchObject({ kind: "interactive", surface: "overlay" })
  })

  test("inline 集合 → interactive/inline", () => {
    expect(triage("fzf")).toMatchObject({ kind: "interactive", surface: "inline" })
    expect(triage("gitui")).toMatchObject({ kind: "interactive", surface: "inline" })
  })

  test("inline 优先于 overlay（同名时取 inline）", () => {
    const t = classifyInput("bash", {
      which,
      overlay: new Set(["bash"]),
      inline: new Set(["bash"]),
    })
    expect(t.surface).toBe("inline")
  })

  test("PATH 中可解析的命令 → command", () => {
    expect(triage("ls").kind).toBe("command")
    expect(triage("ls -la").kind).toBe("command")
    expect(triage("git status").kind).toBe("command")
    expect(triage("\"echo\" ok").kind).toBe("command")
  })

  test("含 shell 元字符 → command（即便首词不在 PATH）", () => {
    expect(triage("ls | grep foo").kind).toBe("command")
    expect(triage("echo hi > /tmp/x").kind).toBe("command")
    expect(triage("foo=bar; echo $foo").kind).toBe("command")
    expect(triage("cat *.txt").kind).toBe("command")
    expect(triage("unknown *.txt").kind).toBe("command")
    expect(triage("echo \"unfinished").kind).toBe("command")
  })

  test("无法解析且无元字符 → agent", () => {
    expect(triage("帮我看看这段代码").kind).toBe("agent")
    expect(triage("what is the weather").kind).toBe("agent")
    expect(triage("   ").kind).toBe("agent")
  })

  test("拆出首词与参数", () => {
    const t = triage("vim a.txt b.txt")
    expect(t.command).toBe("vim")
    expect(t.args).toEqual(["a.txt", "b.txt"])
    expect(t.raw).toBe("vim a.txt b.txt")
  })
})
