import { basename } from "node:path"
import { lexShell } from "./lexer"

export type SyntaxDiagnostic =
  | { kind: "valid"; message?: undefined }
  | { kind: "incomplete" | "invalid"; message: string }

export function resolveShell(shell?: string): string {
  return shell || process.env.SHELL || "/bin/sh"
}

export async function checkShellSyntax(
  line: string,
  shell: string,
  cwd: string,
): Promise<SyntaxDiagnostic> {
  if (line.trim() === "") return { kind: "valid" }
  const dialect = basename(shell)
  const args = dialect === "bash"
    ? ["--noprofile", "--norc", "-n", "-c", line]
    : dialect === "zsh"
      ? ["-f", "-n", "-c", line]
      : ["-n", "-c", line]
  const proc = Bun.spawn([shell, ...args], {
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env, BASH_ENV: "", ENV: "" },
  })
  const timer = setTimeout(() => proc.kill("SIGKILL"), 1500)
  try {
    const [code, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    ])
    if (code === 0) return { kind: "valid" }
    const message = stderr.trim().split("\n").at(-1) || `${dialect} 语法检查失败`
    const incomplete = lexShell(line).incomplete || /unexpected (?:end of file|EOF)|unmatched|matching/.test(stderr)
    return { kind: incomplete ? "incomplete" : "invalid", message }
  } finally {
    clearTimeout(timer)
  }
}
