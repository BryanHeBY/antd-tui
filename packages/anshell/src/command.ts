/** 一次性命令执行：经 sh -lc 跑整行，流式把 stdout/stderr 按行喂回。 */
export interface RunningCommand {
  kill(signal?: number | NodeJS.Signals): void
  readonly exited: Promise<number>
}

export interface RunCommandOptions {
  line: string
  cwd: string
  env?: Record<string, string>
  onLine: (text: string, stream: "out" | "err") => void
}

// piped stdout 通常已无着色，但有些程序无条件发 SGR；防御性剥掉，保对话面板干净。
const ANSI_ESCAPE = /\x1b\[[0-9;?]*[A-Za-z]/g

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, "")
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  kind: "out" | "err",
  onLine: (text: string, stream: "out" | "err") => void,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) onLine(stripAnsi(line), kind)
    }
    if (buffer.length > 0) onLine(stripAnsi(buffer), kind)
  } finally {
    reader.releaseLock()
  }
}

/**
 * 用登录 shell 跑整行，使管道 / 重定向 / glob / 变量都成立（对照 antop/snapshot.ts
 * 的 Bun.spawn(["sh","-c",...]) 用法）。stdout/stderr 分流按行回调；进程退出时
 * resolve 退出码。宿主可 kill 来中断（对话层 Ctrl-C）。
 */
export function runCommand(opts: RunCommandOptions): RunningCommand {
  const proc = Bun.spawn(["sh", "-lc", opts.line], {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  void pump(proc.stdout as ReadableStream<Uint8Array>, "out", opts.onLine)
  void pump(proc.stderr as ReadableStream<Uint8Array>, "err", opts.onLine)

  return {
    kill: (signal) => proc.kill(signal as never),
    exited: proc.exited,
  }
}
