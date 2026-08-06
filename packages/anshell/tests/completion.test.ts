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
  await mkdir(join(dir, "apps"))
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
    const result = await completeShellInput("ls d", 4, cwd)
    expect(result.items.map((i) => i.label)).toEqual(["dev/"])
    expect(result.items[0]!.kind).toBe("directory")
  })
})
