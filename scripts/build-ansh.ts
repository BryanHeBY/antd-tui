#!/usr/bin/env bun
// opentui 用静态 `await import("@opentui/core-<platform>")` 取原生库路径，打包器会尝试解析
// 全部平台包，而 optionalDependencies 只装了宿主那一个 —— 所以除宿主包外都得 external。
const PLATFORM_PACKAGES = [
  "@opentui/core-darwin-x64",
  "@opentui/core-darwin-arm64",
  "@opentui/core-linux-x64",
  "@opentui/core-linux-x64-musl",
  "@opentui/core-linux-arm64",
  "@opentui/core-linux-arm64-musl",
  "@opentui/core-win32-x64",
  "@opentui/core-win32-arm64",
]

const hostPackage = () => {
  const { platform, arch } = process
  const musl = process.env.OPENTUI_LIBC === "musl" ? "-musl" : ""
  if (platform === "darwin") return `@opentui/core-darwin-${arch}`
  if (platform === "linux") return `@opentui/core-linux-${arch}${musl}`
  if (platform === "win32") return `@opentui/core-win32-${arch}`
  return null
}

const host = hostPackage()
if (!host || !PLATFORM_PACKAGES.includes(host)) {
  console.error(`opentui 不支持当前平台: ${process.platform}-${process.arch}`)
  process.exit(1)
}

const externals = PLATFORM_PACKAGES.filter((name) => name !== host)
const proc = Bun.spawn(
  [
    "bun",
    "build",
    "--compile",
    "packages/anshell/src/cli.tsx",
    "--outfile",
    "dist/ansh",
    ...externals.map((name) => `--external=${name}`),
  ],
  { stdio: ["inherit", "inherit", "inherit"] },
)
process.exit(await proc.exited)
