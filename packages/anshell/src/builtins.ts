import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import { statSync } from "node:fs"

/** builtin 执行后要宿主做的副作用。 */
export type BuiltinEffect =
  | { kind: "none" }
  | { kind: "cd"; cwd: string }
  | { kind: "clear" }
  | { kind: "exit" }
  | { kind: "print"; text: string; error?: boolean }

const BUILTIN_NAMES = new Set(["cd", "pwd", "clear", "exit", "logout"])

export function isBuiltin(command: string): boolean {
  return BUILTIN_NAMES.has(command)
}

/** 把 ~ / 相对路径解析成绝对路径。 */
function expandPath(target: string, cwd: string): string {
  if (target === "~" || target === "") return homedir()
  if (target.startsWith("~/")) return resolve(homedir(), target.slice(2))
  if (isAbsolute(target)) return target
  return resolve(cwd, target)
}

/**
 * 处理内建命令。cd 无法交给子进程（改不了宿主 cwd），必须在 anshell 内维护。
 * 输入 argv（首词是命令）+ 当前 cwd，返回宿主要执行的副作用。
 */
export function runBuiltin(argv: string[], cwd: string): BuiltinEffect {
  const [name, ...rest] = argv
  switch (name) {
    case "cd": {
      const target = expandPath(rest[0] ?? "", cwd)
      try {
        if (!statSync(target).isDirectory()) {
          return { kind: "print", text: `cd: 不是目录：${target}`, error: true }
        }
      } catch {
        return { kind: "print", text: `cd: 目录不存在：${target}`, error: true }
      }
      return { kind: "cd", cwd: target }
    }
    case "pwd":
      return { kind: "print", text: cwd }
    case "clear":
      return { kind: "clear" }
    case "exit":
    case "logout":
      return { kind: "exit" }
    default:
      return { kind: "none" }
  }
}
