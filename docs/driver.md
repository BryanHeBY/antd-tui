# engine 驱动器:快照导出与交互会话

面向测试与 agent 的无头(无 TTY)基础设施:`--snapshot` 把界面导出为字符画/矢量图,`--drive` 提供 Playwright 式的实时交互会话(看帧 → 操作 → 再看帧)。两者共用与真实渲染完全相同的组件与布局管线,所见即真机。

## 1. `--snapshot`:单帧导出

```sh
engine --schema x.schema.json --snapshot                        # 纯字符画 → stdout
engine --schema x.schema.json --snapshot --format ansi          # 24 位色转义序列,终端 cat 预览
engine --schema x.schema.json --snapshot --format svg > x.svg   # 矢量图,浏览器/IDE 直接查看
engine --schema x.schema.json --snapshot --size 100x30 --out x.svg --format svg
```

- `--format`:`text`(默认)/ `ansi` / `svg`;`--size <宽>x<高>` 默认 `80x24`
- 无 `--out` 时 stdout 就是内容本身(可重定向/管道);有 `--out` 时写文件并输出 `{"event":"snapshot","path":...}`
- 静态校验失败仍输出 `{"event":"invalid",...}`,退出码 2
- 需要位图时用 `rsvg-convert` / `resvg` 把 SVG 转 PNG

## 2. `--drive`:交互会话(stdio NDJSON)

```sh
engine --schema x.schema.json --drive [--size 80x24]
```

启动后输出 `{"event":"ready","cols":80,"rows":24}`,随后 stdin 每行一条 JSON 指令、stdout 每行一条响应。

### 指令集

| 指令 | 说明 |
|---|---|
| `{"id":1,"op":"snapshot","format":"text\|ansi\|svg"}` | 取当前帧 |
| `{"id":2,"op":"click","text":"部署"}` | 按可见文本定位并点击(点中部;宽字符列已换算) |
| `{"id":3,"op":"click","x":5,"y":20}` | 按屏幕列坐标点击 |
| `{"id":4,"op":"type","text":"user-api"}` | 输入文本(进当前聚焦的输入组件) |
| `{"id":5,"op":"press","key":"tab"}` | 按键:tab/enter/escape/up/down/left/right/backspace/delete/home/end 或单字符 |
| `{"id":6,"op":"locate","text":"部署"}` | 只定位不点击,返回 `{x,y}` |
| `{"id":7,"op":"values"}` | 读当前 `form.values` |
| `{"id":8,"op":"quit"}` | 结束会话(等价取消) |

### 响应与约定

- 每条响应带回显 `id`:`{"id":N,"ok":true,...}` 或 `{"id":N,"ok":false,"error":"..."}`
- **输入类操作(click/type/press)自动 settle 一帧并在响应里带回新 `frame`(text 格式)**——操作即反馈;加 `"return":"none"` 省流量,`"return":"ansi"/"svg"` 换格式
- 页面完成时穿透标准事件并退出:`{"event":"submit","values":{...}}`(退出码 0)/ `{"event":"cancel"}`(退出码 1);stdin 关闭视为放弃,等价 cancel
- 坐标系:x 为**屏幕列**(CJK 宽字符占 2 列),y 为行,均从 0 起

### agent 用法示例(bash 管道一把梭)

```sh
{
  echo '{"id":1,"op":"click","text":"7","return":"none"}'
  echo '{"id":2,"op":"click","text":"+","return":"none"}'
  echo '{"id":3,"op":"click","text":"8","return":"none"}'
  echo '{"id":4,"op":"click","text":"="}'
  echo '{"id":5,"op":"values"}'
  echo '{"id":6,"op":"press","key":"escape"}'
} | bun packages/engine/src/cli.ts --schema examples/calculator.schema.json --drive
# → …{"id":5,"ok":true,"values":{"display":"15"}}
# → {"event":"submit","values":{"display":"15"}}   退出码 0
```

长会话(边看边操作)建议用双向管道(coproc / 子进程 stdio),每发一条指令读一条响应。

## 3. 三种预检/观测手段怎么选

| 手段 | 用途 |
|---|---|
| `--dry-run` | 最快,纯静态校验(结构/未知键/表达式/props 键) |
| `--check` | 静态校验 + 无头挂载一帧,兜运行时崩溃 |
| `--snapshot` | 看长相:生成后自查布局/文案/配色 |
| `--drive` | 走流程:模拟用户完整操作路径,断言 values 与回传 |
