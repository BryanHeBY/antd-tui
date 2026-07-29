/**
 * REPL 版服务监控面板：与 examples/schema/service-dashboard.json 功能一致。
 * schema 版靠 $state + "{{ }}" 表达式联动；REPL 版是真闭包——
 * Progress/Descriptions 的联动用 $ui.watch 写回 props，定时器直接 setTimeout。
 *
 * 运行：bun run examples:dash:repl（需要 TTY）；热键 1/2/3 切换服务，r 刷新，+/- 模拟负载，Esc 退出
 */
import type { LiveUi } from "@antd-tui/live"

export function buildServiceDashboard($ui: LiveUi): void {
  $ui.page({
    title: "服务监控面板（REPL 版）",
    description: "热键 1/2/3 切换服务，r 刷新，+/- 模拟负载，Esc 退出",
    mode: "interactive",
  })

  $ui.add("Alert", {
    props: {
      type: "warning",
      showIcon: true,
      message: "cn-north 集群今晚 23:00 例行维护，新实例调度可能延迟",
    },
  })

  const tags = $ui.add("Space", { props: { size: 2 } })
  tags.add("Tag", { content: "SLA 达标", props: { color: "success" } })
  tags.add("Tag", { content: "灰度中", props: { color: "processing" } })
  tags.add("Tag", { content: "cn-north", props: { bordered: false } })

  const stats = $ui.add("Row", { props: { gutter: 2 } })
  stats
    .add("Col", { props: { flex: 1 } })
    .add("Statistic", { props: { value: 12483, title: "请求量", suffix: "次/分" } })
  stats.add("Col", { props: { flex: 1 } }).add("Statistic", {
    props: { value: 0.42, title: "错误率", precision: 2, suffix: "%", tuiValueType: "danger" },
  })
  stats.add("Col", { props: { flex: 1 } }).add("Statistic", {
    props: { value: 36, title: "持续运行", suffix: "天", tuiValueType: "success" },
  })

  // —— 节点负载：$ui.data.cpu 驱动，watch 写回 Progress props ——
  $ui.data.cpu = 42
  const loadCard = $ui.add("Card", { props: { title: "节点负载" } })
  loadCard.add("Progress", { id: "cpuBar", props: { percent: 42, status: "active" } })
  const loadBtns = loadCard.add("Space", { props: { size: 2 } })
  const addLoad = (d: number) => {
    $ui.data.cpu = Math.min(100, Math.max(0, Number($ui.data.cpu) + d))
  }
  loadBtns.add("Button", {
    content: "负载 +10",
    props: { tuiSize: "small", tuiHotkey: "+", tuiOnClick: () => addLoad(10) },
  })
  loadBtns.add("Button", {
    content: "负载 -10",
    props: { tuiSize: "small", tuiHotkey: "-", tuiOnClick: () => addLoad(-10) },
  })
  $ui.watch(
    () => Number($ui.data.cpu),
    (cpu) => {
      const bar = $ui.get("cpuBar").props
      bar.percent = cpu
      bar.status = cpu >= 90 ? "exception" : "active"
    },
  )

  // —— 服务详情：真数据表 + 真函数联动 ——
  const SERVICES = [
    { name: "gateway", ver: "v2.4.1", node: "node-01", owner: "平台组", qps: "3.2k" },
    { name: "user-api", ver: "v1.9.0", node: "node-02", owner: "账号组", qps: "1.1k" },
    { name: "billing", ver: "v3.1.7", node: "node-03", owner: "交易组", qps: "640" },
  ]
  const detailItems = (i: number) => {
    const d = SERVICES[i]!
    return [
      { label: "服务名", children: d.name },
      { label: "版本", children: d.ver },
      { label: "所在节点", children: d.node },
      { label: "负责团队", children: d.owner },
      { label: "QPS", children: d.qps },
      { label: "健康检查", children: "通过" },
    ]
  }

  const detailCard = $ui.add("Card", { props: { title: "服务详情" } })
  const svcBtns = detailCard.add("Space", { props: { size: 2 } })
  const selectService = (i: number) => {
    const desc = $ui.get("svcDesc").props
    desc.title = `${SERVICES[i]!.name} 详情`
    desc.items = detailItems(i)
  }
  SERVICES.forEach((svc, i) => {
    svcBtns.add("Button", {
      content: `${i + 1} ${svc.name}`,
      props: { tuiSize: "small", tuiHotkey: String(i + 1), tuiOnClick: () => selectService(i) },
    })
  })
  // 刷新：定时器活在闭包里，不需要 $memo 通道
  let timer: ReturnType<typeof setTimeout> | null = null
  const refresh = () => {
    if (timer) clearTimeout(timer)
    $ui.get("spin").props.spinning = true
    timer = setTimeout(() => {
      $ui.get("spin").props.spinning = false
      timer = null
    }, 600)
  }
  svcBtns.add("Button", {
    content: "刷新 (r)",
    props: { tuiSize: "small", tuiHotkey: "r", tuiOnClick: refresh },
  })
  detailCard
    .add("Spin", { id: "spin", props: { spinning: false, tip: "刷新中..." } })
    .add("Descriptions", {
      id: "svcDesc",
      props: { title: "gateway 详情", column: 3, items: detailItems(0) },
    })

  // —— 实例列表 ——
  $ui.add("Divider", { content: "实例列表", props: { orientation: "left", dashed: true } })
  $ui.add("Table", {
    props: {
      rowKey: "id",
      columns: [
        { title: "实例", dataIndex: "id", width: 10 },
        { title: "服务", dataIndex: "service", width: 10 },
        { title: "状态", dataIndex: "status", width: 8, align: "center" },
        { title: "CPU", dataIndex: "cpu", width: 6, align: "right" },
        { title: "内存", dataIndex: "mem", width: 8, align: "right" },
      ],
      dataSource: [
        { id: "i-01", service: "gateway", status: "运行中", cpu: "41%", mem: "512Mi" },
        { id: "i-02", service: "user-api", status: "运行中", cpu: "23%", mem: "384Mi" },
        { id: "i-03", service: "billing", status: "重启中", cpu: "87%", mem: "896Mi" },
      ],
    },
  })
}

if (import.meta.main) {
  const { runLiveExample } = await import("./host")
  await runLiveExample(($ui) => buildServiceDashboard($ui))
}
