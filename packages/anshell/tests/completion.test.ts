import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { completeShellInput } from "../src/shell"

let dir = ""
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ""
})

async function fixture(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "ansh-comp-"))
  await mkdir(join(dir, "dev"))
  await mkdir(join(dir, "dev", "inner"))
  await writeFile(join(dir, "dev", "note.md"), "")
  await mkdir(join(dir, "apps"))
  await mkdir(join(dir, "docs"))
  await mkdir(join(dir, ".config"))
  await writeFile(join(dir, ".bashrc"), "")
  await writeFile(join(dir, "readme.txt"), "")
  return dir
}

describe("completeShellInput 路径补全", () => {
  test("ls <空前缀> 隐藏点文件，露出真实目录", async () => {
    const cwd = await fixture()
    const result = await completeShellInput("ls ", 3, cwd)
    const labels = result.items.map((i) => i.label)
    expect(labels).toContain("dev/")
    expect(labels).toContain("apps/")
    expect(labels).toContain("readme.txt")
    expect(labels.some((l) => l.startsWith("."))).toBe(false)
  })

  test("前缀以 . 开头时照常列出点文件", async () => {
    const cwd = await fixture()
    const result = await completeShellInput("ls .", 4, cwd)
    const labels = result.items.map((i) => i.label)
    expect(labels).toContain(".config/")
    expect(labels).toContain(".bashrc")
    expect(labels).not.toContain("dev/")
  })

  test("普通前缀正常匹配", async () => {
    const cwd = await fixture()
    const result = await completeShellInput("ls de", 5, cwd)
    expect(result.items.map((i) => i.label)).toEqual(["dev/"])
    expect(result.items[0]!.kind).toBe("directory")
  })

  test("补全目录后再 Tab 进入其内容（结尾 / 不再退化）", async () => {
    const cwd = await fixture()
    const result = await completeShellInput("ls dev/", 7, cwd)
    const labels = result.items.map((i) => i.label)
    expect(labels).toContain("dev/inner/")
    expect(labels).toContain("dev/note.md")
    // 不再错误地把 dev/ 当成在 cwd 里找 "dev"
    expect(labels).not.toContain("dev/")
  })
  test("shell 关键字（do/in/then…）作为参数仍能补全，不塌成空词", async () => {
    const cwd = await fixture()
    // "do" 在词法层是 operator，但这里是 ls 的参数，应按词补全为 docs/
    const result = await completeShellInput("ls do", 5, cwd)
    expect(result).toMatchObject({ start: 3, end: 5 })
    expect(result.items.map((i) => i.label)).toEqual(["docs/"])
  })
})
