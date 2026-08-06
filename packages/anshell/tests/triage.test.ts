import { describe, expect, test } from "bun:test"
import { classifyInput } from "../src/index"

/** 传桩 which：只认这几个「存在的命令」。 */
const which = (cmd: string) => [
  "ls", "git", "echo", "cat", "grep", "npm", "rm", "sudo", "bash", "zsh", "vim", "htop", "ssh",
].includes(cmd)

function triage(line: string) {
  return classifyInput(line, { which })
}

describe("classifyInput", () => {
  test("不按命令名特判：bash/vim 都是普通命令，浮层由 alternate screen 自动判定", () => {
    expect(triage("bash")).toMatchObject({ kind: "command" })
    expect(triage("zsh")).toMatchObject({ kind: "command" })
    expect(triage("vim foo.txt")).toMatchObject({ kind: "command" })
  })

  test("已知命令一律 command，交给长驻 shell", () => {
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
