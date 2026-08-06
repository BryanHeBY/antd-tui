import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { ShellDialect } from "./dialect"

/**
 * shell integration 的注入。
 *
 * 思路与 VS Code / iTerm 一致：给 shell 一份临时 rc，先 source 用户自己的配置，再往
 * prompt 钩子里**追加**我们的标记函数。追加而不是设 PS1，是为了和 starship / p10k /
 * oh-my-zsh 这类每个 prompt 都重写 PS1 的框架共存。
 *
 * 标记语义（FinalTerm / OSC 133）：
 *   A = 回到 prompt   C = 命令开始执行   D;<exit> = 命令结束
 * 每条标记都带 `ansh=<nonce>`：用户在会话里再开一层 bash/zsh 时，那层用的是他自己的
 * rc（可能自带别家的 shell integration），它打出的标记 nonce 不符会被宿主丢掉，
 * 否则内层的 D 会把外层卡片提前截断。
 */
export type ShellInit = "user" | "minimal"

export interface ShellRcOptions {
  dialect: ShellDialect
  /** 本次进程的随机串，用于过滤嵌套 shell 的标记 */
  nonce: string
  /** 静默命令的请求/回包目录 */
  runtimeDir: string
  /** user = 先 source 用户配置；minimal = 干净环境（测试用） */
  init: ShellInit
  /** 用户原本的 ZDOTDIR（zsh 用；空串表示原本没有） */
  userZdotdir?: string
}

/** bash 的 rc 源码。`--rcfile` 会顶掉 ~/.bashrc，所以要自己先 source 回来。 */
export function bashRcSource(opts: ShellRcOptions): string {
  const user = opts.init === "user"
  return `# ansh shell integration（自动生成，可删）
${user ? '[ -f ~/.bashrc ] && . ~/.bashrc' : 'PS1="ANSH> "\nHISTFILE=/dev/null'}

# 静默命令以空格开头，别进历史，也别毒化 !!
HISTCONTROL="\${HISTCONTROL:+\$HISTCONTROL:}ignorespace"

__ansh_output_start() { printf '\\033]133;C;ansh=%s\\007' "\$ANSH_NONCE"; }

__ansh_precmd() {
  local __ansh_st=\$?
  # 静默命令不能覆盖用户命令的退出码
  if [ -z "\${__ansh_hidden-}" ]; then __ansh_user_status=\$__ansh_st; fi
  unset __ansh_hidden
  printf '\\033]133;D;%s;ansh=%s\\007' "\$__ansh_st" "\$ANSH_NONCE"
  printf '\\033]7;file://%s%s\\007' "\${HOSTNAME:-localhost}" "\$PWD"
  printf '\\033]133;A;ansh=%s\\007' "\$ANSH_NONCE"
  __ansh_heal
  return \$__ansh_st
}

__ansh_install() {
  # 必须前置：bash 不会在 PROMPT_COMMAND 的多个元素之间恢复 \$?
  if [ -n "\${BASH_VERSINFO-}" ] && { [ "\${BASH_VERSINFO[0]}" -gt 5 ] || { [ "\${BASH_VERSINFO[0]}" -eq 5 ] && [ "\${BASH_VERSINFO[1]}" -ge 1 ]; }; }; then
    PROMPT_COMMAND=(__ansh_precmd "\${PROMPT_COMMAND[@]}")
  else
    PROMPT_COMMAND="__ansh_precmd\${PROMPT_COMMAND:+;\$PROMPT_COMMAND}"
  fi
  PS0='\\[\$(__ansh_output_start)\\]'"\${PS0-}"
}

# prompt 框架可能在自己的钩子里重置 PROMPT_COMMAND/PS0，每个 prompt 自愈一次
__ansh_heal() {
  case "\${PROMPT_COMMAND[*]-}" in
    *__ansh_precmd*) ;;
    *) __ansh_install ;;
  esac
  case "\${PS0-}" in
    *__ansh_output_start*) ;;
    *) PS0='\\[\$(__ansh_output_start)\\]'"\${PS0-}" ;;
  esac
}

# 静默命令：请求与回包都走文件，PTY 上只出现一个 id，无需引号转义
__ansh_reply() {
  __ansh_hidden=1
  eval "\$(cat "\$ANSH_RUNTIME/req/\$1")" > "\$ANSH_RUNTIME/res/\$1" 2>&1
  return \${__ansh_user_status:-0}
}

__ansh_install
`
}

/** zsh 的钩子片段（.zshrc 尾部）。 */
function zshHooks(): string {
  return `
autoload -Uz add-zsh-hook
setopt hist_ignore_space

__ansh_preexec() { printf '\\033]133;C;ansh=%s\\007' "\$ANSH_NONCE" }

__ansh_precmd() {
  local __ansh_st=\$?
  if [[ -z \${__ansh_hidden-} ]]; then __ansh_user_status=\$__ansh_st; fi
  unset __ansh_hidden
  printf '\\033]133;D;%s;ansh=%s\\007' "\$__ansh_st" "\$ANSH_NONCE"
  printf '\\033]7;file://%s%s\\007' "\${HOST:-localhost}" "\$PWD"
  printf '\\033]133;A;ansh=%s\\007' "\$ANSH_NONCE"
  # prompt 框架若替换了钩子数组，重新挂回来
  (( \${precmd_functions[(I)__ansh_precmd]} )) || add-zsh-hook precmd __ansh_precmd
  (( \${preexec_functions[(I)__ansh_preexec]} )) || add-zsh-hook preexec __ansh_preexec
  return \$__ansh_st
}

__ansh_reply() {
  __ansh_hidden=1
  eval "\$(cat "\$ANSH_RUNTIME/req/\$1")" > "\$ANSH_RUNTIME/res/\$1" 2>&1
  return \${__ansh_user_status:-0}
}

add-zsh-hook precmd __ansh_precmd
add-zsh-hook preexec __ansh_preexec
`
}

/**
 * zsh 的启动文件链。ZDOTDIR 必须在整个启动期指向我们的目录（否则 zsh 去用户目录找
 * .zshrc，钩子就装不上），装完最后一份（非登录交互 shell 是 .zshrc）再还原——不然
 * 会话里再开一层 zsh 会继续加载我们的 rc。
 */
export function zshRcSources(opts: ShellRcOptions): Record<string, string> {
  const user = opts.init === "user"
  const chain = (name: string) =>
    user ? `[ -f "\${ANSH_USER_ZDOTDIR:-$HOME}/${name}" ] && . "\${ANSH_USER_ZDOTDIR:-$HOME}/${name}"\n` : ""
  const restore = `
if [ -n "\${ANSH_USER_ZDOTDIR-}" ]; then export ZDOTDIR="\$ANSH_USER_ZDOTDIR"; else unset ZDOTDIR; fi
`
  return {
    ".zshenv": `# ansh shell integration（自动生成，可删）\n${chain(".zshenv")}`,
    ".zprofile": `${chain(".zprofile")}`,
    ".zshrc": `${chain(".zshrc")}${user ? "" : 'PROMPT="ANSH> "\nHISTFILE=/dev/null\n'}${zshHooks()}${restore}`,
    ".zlogin": `${chain(".zlogin")}`,
  }
}

export interface ShellLaunch {
  command: string
  args: string[]
  env: Record<string, string>
  /** 临时目录（rc + 静默命令通道），退出时删掉 */
  dir: string
  runtimeDir: string
  cleanup: () => Promise<void>
}

/** 落盘临时 rc 并给出启动参数。 */
export async function writeShellRc(
  shellPath: string,
  opts: Omit<ShellRcOptions, "runtimeDir" | "userZdotdir">,
): Promise<ShellLaunch> {
  const dir = await mkdtemp(join(tmpdir(), "ansh-"))
  const runtimeDir = join(dir, "run")
  await mkdir(join(runtimeDir, "req"), { recursive: true })
  await mkdir(join(runtimeDir, "res"), { recursive: true })
  const full: ShellRcOptions = {
    ...opts,
    runtimeDir,
    userZdotdir: process.env.ZDOTDIR ?? "",
  }
  const env: Record<string, string> = {
    ANSH_NONCE: opts.nonce,
    ANSH_RUNTIME: runtimeDir,
    ANSH_INIT: opts.init,
    TERM_PROGRAM: "ansh",
  }
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  if (opts.dialect === "bash") {
    await writeFile(join(dir, "rc"), bashRcSource(full), "utf8")
    return { command: shellPath, args: ["--rcfile", join(dir, "rc"), "-i"], env, dir, runtimeDir, cleanup }
  }

  for (const [name, source] of Object.entries(zshRcSources(full))) {
    await writeFile(join(dir, name), source, "utf8")
  }
  return {
    command: shellPath,
    args: ["-i"],
    env: { ...env, ZDOTDIR: dir, ANSH_USER_ZDOTDIR: process.env.ZDOTDIR ?? "" },
    dir,
    runtimeDir,
    cleanup,
  }
}
