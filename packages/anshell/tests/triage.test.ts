import { describe, expect, test } from "bun:test"
import { classifyInput, DEFAULT_OVERLAY_COMMANDS } from "../src/index"

const overlay = new Set(DEFAULT_OVERLAY_COMMANDS)
const inline = new Set(["fzf", "gitui"])

/** 传桩 which：只认这几个「存在的可执行」。 */
const which = (cmd: string) => [
  "ls", "git", "echo", "cat", "grep", "npm", "rm", "sudo", "bash", "zsh", "vim", "htop", "ssh",
].includes(cmd)

function triage(line: string) {
  return classifyInput(line, { which, overlay, inline })
}

describe("classifyInput", () => {
  test("默认不按命令名特判，显式 overlay 配置仍可覆盖", () => {
    expect(DEFAULT_OVERLAY_COMMANDS).toEqual([])
    expect(triage("bash")).toMatchObject({ kind: "command" })
    expect(triage("zsh")).toMatchObject({ kind: "command" })
    expect(triage("vim foo.txt")).toMatchObject({ kind: "command" })
    const explicit = classifyInput("bash", { which, overlay: new Set(["bash"]), inline: new Set() })
    expect(explicit).toMatchObject({ kind: "interactive", surface: "overlay" })
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

  test("所有普通命令都保留 command 路径，由流内 PTY 提供 stdin", () => {
    expect(triage("cat")).toMatchObject({ kind: "command" })
    expect(triage("cat -")).toMatchObject({ kind: "command" })
    expect(triage("cat -n")).toMatchObject({ kind: "command" })
    expect(triage("cat -- -")).toMatchObject({ kind: "command" })
    expect(triage("cat file.txt")).toMatchObject({ kind: "command" })
    expect(triage("cat --help")).toMatchObject({ kind: "command" })
    expect(triage("sudo ls")).toMatchObject({ kind: "command" })
    expect(triage("git commit")).toMatchObject({ kind: "command" })
    expect(triage("git commit -m done")).toMatchObject({ kind: "command" })
    expect(triage("rm -i file.txt")).toMatchObject({ kind: "command" })
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
