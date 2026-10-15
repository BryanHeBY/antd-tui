/**
 * 卡片底色常量。主题 token 里没有 fill 色阶（colorBgContainer 是 transparent），
 * 沿用 antop 的做法：直接定义贴合黑底的一小组底色。越靠近交互焦点越亮。
 */
export const cardTint = {
  /** 已提交命令与流尾草稿：较亮，表示人的输入。 */
  input: "#1f1f1f",
  /** 命令 stdout/stderr 与运行状态：较暗，紧贴在对应输入下方。 */
  output: "#171717",
  /** @deprecated 使用 output；保留旧键避免破坏外部主题引用。 */
  command: "#171717",
  /** agent 回复卡片 */
  agent: "#1a1a1a",
  /** agent 执行的命令卡（◆）：暖色偏移，与用户命令的灰阶一眼可分 */
  agentInput: "#241f18",
  /** agent 执行命令的输出体：同暖色系再压暗一档 */
  agentOutput: "#1a1712",
  terminal: "#141414",
  /** 浮层窗口背景 */
  overlay: "#141414",
} as const
