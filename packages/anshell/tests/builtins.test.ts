import { describe, expect, test } from "bun:test"
import { homedir, tmpdir } from "node:os"
import { isBuiltin, runBuiltin } from "../src/index"

describe("isBuiltin", () => {
  test("识别内建命令", () => {
    expect(isBuiltin("cd")).toBe(true)
    expect(isBuiltin("pwd")).toBe(true)
    expect(isBuiltin("clear")).toBe(true)
    expect(isBuiltin("exit")).toBe(true)
    expect(isBuiltin("ls")).toBe(false)
    expect(isBuiltin("")).toBe(false)
  })
})

describe("runBuiltin", () => {
  test("cd 进入存在的目录", () => {
    const effect = runBuiltin(["cd", tmpdir()], "/")
    expect(effect).toEqual({ kind: "cd", cwd: tmpdir() })
  })

  test("cd 无参数回到 home", () => {
    const effect = runBuiltin(["cd"], "/tmp")
    expect(effect).toEqual({ kind: "cd", cwd: homedir() })
  })

  test("cd ~ 展开到 home", () => {
    expect(runBuiltin(["cd", "~"], "/tmp")).toEqual({ kind: "cd", cwd: homedir() })
  })

  test("cd 相对路径基于当前 cwd 解析", () => {
    const effect = runBuiltin(["cd", "."], tmpdir())
    expect(effect).toEqual({ kind: "cd", cwd: tmpdir() })
  })

  test("cd 不存在的目录报错", () => {
    const effect = runBuiltin(["cd", "/no/such/dir/xyz"], "/")
    expect(effect.kind).toBe("print")
    if (effect.kind === "print") expect(effect.error).toBe(true)
  })

  test("pwd 打印当前 cwd", () => {
    expect(runBuiltin(["pwd"], "/home/foo")).toEqual({ kind: "print", text: "/home/foo" })
  })

  test("clear / exit", () => {
    expect(runBuiltin(["clear"], "/")).toEqual({ kind: "clear" })
    expect(runBuiltin(["exit"], "/")).toEqual({ kind: "exit" })
    expect(runBuiltin(["logout"], "/")).toEqual({ kind: "exit" })
  })

  test("非内建返回 none", () => {
    expect(runBuiltin(["ls"], "/")).toEqual({ kind: "none" })
  })
})
