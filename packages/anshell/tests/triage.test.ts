import { describe, expect, test } from "bun:test"
import { classifyInput, DEFAULT_INTERACTIVE_COMMANDS } from "../src/index"

const interactive = new Set(DEFAULT_INTERACTIVE_COMMANDS)

/** 传桩 which：只认 ls/git/echo/cat 这几个「存在的可执行」。 */
const which = (cmd: string) => ["ls", "git", "echo", "cat", "grep", "npm"].includes(cmd)

function kind(line: string) {
  return classifyInput(line, { which, interactive }).kind
}

describe("classifyInput", () => {
  test("交互式程序 → interactive", () => {
    expect(kind("bash")).toBe("interactive")
    expect(kind("vim foo.txt")).toBe("interactive")
    expect(kind("htop")).toBe("interactive")
    expect(kind("python3")).toBe("interactive")
    expect(kind("ssh host")).toBe("interactive")
  })

  test("PATH 中可解析的命令 → command", () => {
    expect(kind("ls")).toBe("command")
    expect(kind("ls -la")).toBe("command")
    expect(kind("git status")).toBe("command")
  })

  test("含 shell 元字符 → command（即便首词不在 PATH）", () => {
    expect(kind("ls | grep foo")).toBe("command")
    expect(kind("echo hi > /tmp/x")).toBe("command")
    expect(kind("foo=bar; echo $foo")).toBe("command")
    expect(kind("cat *.txt")).toBe("command")
  })

  test("无法解析且无元字符 → agent", () => {
    expect(kind("帮我看看这段代码")).toBe("agent")
    expect(kind("what is the weather")).toBe("agent")
    expect(kind("summarize the readme")).toBe("agent")
  })

  test("交互式优先于 PATH（bash 既在 PATH 也在交互集）", () => {
    expect(classifyInput("bash -i", { which: () => true, interactive }).kind).toBe("interactive")
  })

  test("拆出首词与参数", () => {
    const t = classifyInput("vim a.txt b.txt", { which, interactive })
    expect(t.command).toBe("vim")
    expect(t.args).toEqual(["a.txt", "b.txt"])
    expect(t.raw).toBe("vim a.txt b.txt")
  })

  test("空行 → agent（无首词、无元字符）", () => {
    expect(kind("   ")).toBe("agent")
  })
})
