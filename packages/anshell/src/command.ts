/** 一次性命令执行：经配置的 Shell 跑整行，流式把 stdout/stderr 按行喂回。 */
export interface RunningCommand {
  kill(signal?: number | NodeJS.Signals): void
  readonly exited: Promise<number>
}

export interface RunCommandOptions {
  line: string
  cwd: string
  /** 与语法检查一致的 Shell 可执行文件；默认 /bin/sh。 */
  shell?: string
  env?: Record<string, string>
  onLine: (text: string, stream: "out" | "err") => void
}

interface CommandLaunch {
  cmd: string[]
  /** 是否已为本次命令创建独立 session / process group。 */
  isolatedProcessGroup: boolean
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
 * 单独执行的 shell 命令也必须有自己的进程组：Shell 之下经常还有管道、
 * 重定向程序或后台作业。只杀 shell 会把这些子进程遗留在宿主上。
 *
 * Linux 的 util-linux `setsid` 是最小依赖的实现；没有它的平台保持原有的
 * 单进程降级行为，避免假设 Bun 在所有平台都支持 detached process group。
 */
function resolveLaunch(line: string, shell: string): CommandLaunch {
  if (process.platform === "linux") {
    const setsid = Bun.which("setsid")
    if (setsid) return { cmd: [setsid, shell, "-lc", line], isolatedProcessGroup: true }
  }
  return { cmd: [shell, "-lc", line], isolatedProcessGroup: false }
}

function killCommandProcess(
  proc: ReturnType<typeof Bun.spawn>,
  isolatedProcessGroup: boolean,
  signal: number | NodeJS.Signals,
) {
  if (isolatedProcessGroup && proc.pid > 0) {
    try {
      // 负 PID 是 POSIX 的进程组寻址；setsid 让 leader PID 同时成为 PGID。
      process.kill(-proc.pid, signal)
      return
    } catch {
      // 进程可能刚好退出，或宿主不支持组信号；回退到直接杀 leader。
    }
  }
  proc.kill(signal as never)
}

/**
 * 用登录 shell 跑整行，使管道 / 重定向 / glob / 变量都成立（对照 antop/snapshot.ts
 * 的 Bun.spawn(["sh","-c",...]) 用法）。stdout/stderr 分流按行回调；进程退出时
 * resolve 退出码。宿主可 kill 来中断（对话层 Ctrl-C）。
 */
export function runCommand(opts: RunCommandOptions): RunningCommand {
  const launch = resolveLaunch(opts.line, opts.shell ?? "/bin/sh")
  const proc = Bun.spawn(launch.cmd, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  void pump(proc.stdout as ReadableStream<Uint8Array>, "out", opts.onLine)
  void pump(proc.stderr as ReadableStream<Uint8Array>, "err", opts.onLine)

  return {
    kill: (signal = "SIGTERM") => killCommandProcess(proc, launch.isolatedProcessGroup, signal),
    exited: proc.exited,
  }
}
