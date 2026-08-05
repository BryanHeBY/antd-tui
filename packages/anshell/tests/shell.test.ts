import { describe, expect, test } from "bun:test"
import { checkShellSyntax, commonPrefix, completeShellInput, lexShell } from "../src/index"

describe("Shell 输入分析", () => {
  test("lexer 标记命令、选项、变量、操作符与字符串", () => {
    const result = lexShell('FOO=bar echo --color "$HOME" | grep src')
    expect(result.tokens.map((token) => [token.kind, token.text])).toEqual([
      ["assignment", "FOO=bar"],
      ["command", "echo"],
      ["option", "--color"],
      ["string", '"$HOME"'],
      ["operator", "|"],
      ["command", "grep"],
      ["word", "src"],
    ])
  })

  test("未闭合引号同时标记 error 与 incomplete", () => {
    const result = lexShell('echo "oops')
    expect(result.incomplete).toBe(true)
    expect(result.tokens.at(-1)?.kind).toBe("error")
  })

  test("bash -n 返回合法、未完成与非法诊断", async () => {
    const bash = Bun.which("bash")
    if (!bash) return
    expect(await checkShellSyntax("echo ok", bash, process.cwd())).toEqual({ kind: "valid" })
    expect((await checkShellSyntax('echo "oops', bash, process.cwd())).kind).toBe("incomplete")
    expect((await checkShellSyntax("echo )", bash, process.cwd())).kind).toBe("invalid")
  })
})

describe("Shell 补全", () => {
  test("命令前缀包含 builtin 候选", async () => {
    const result = await completeShellInput("pw", 2, process.cwd(), { PATH: "" })
    expect(result.items.some((item) => item.value === "pwd")).toBe(true)
  })

  test("环境变量补全", async () => {
    const result = await completeShellInput("echo $ANTD_T", 12, process.cwd(), {
      PATH: "",
      ANTD_TUI_MODE: "test",
    })
    expect(result.items.map((item) => item.value)).toContain("$ANTD_TUI_MODE")
  })

  test("公共前缀", () => {
    expect(commonPrefix(["foobar", "foobaz", "fooqux"])).toBe("foo")
  })
})
