/**
 * 命令输出的行区间代数。
 *
 * OSC 133 给出 C（开始执行）和 D（结束）的行列；输出就是这两点之间的 buffer 行，
 * 末行截到 D.col。这里只做纯计算，不碰渲染，方便单测。
 */
export interface MarkPoint {
  row: number
  col: number
}

export interface RangeInput {
  /** 命令开始执行时的位置（OSC 133;C） */
  start: MarkPoint
  /** 命令结束时的位置（OSC 133;D）；运行中为 null */
  end: MarkPoint | null
  /** registerMarker 报出的起始行；被裁掉后为 -1 */
  markRow: number
  /** 运行中的活动光标绝对行 */
  cursorAbsoluteY: number
  /** 视口首行（takeover 降级时用） */
  viewportY: number
  /** 视口高度 */
  viewportRows: number
  /** buffer 总行数 */
  bufferLength: number
  /** 单调水位线：运行中取过的最大结束行，避免 \r 进度条/光标回跳抖动 */
  highWater: number
  /** 本条命令期间是否发生过整屏重画（screenTakeoverSeq 变化） */
  takeover: boolean
}

export interface RangeResult {
  /** 起始绝对行 */
  startY: number
  /** 行数 */
  rows: number
  /** 末行截断列；undefined 表示整行 */
  lastCol?: number
  /** 是否只冻结当前视口（takeover 或标记丢失的兜底） */
  viewport: boolean
  /** 区间不可靠（标记被裁 / 整屏重画 / 没等到 C） */
  degraded: boolean
  /** 新的水位线，回写给下一帧 */
  highWater: number
}

/** C 落在某行的列 0，输出就从这行起；非 0（异常）时从下一行起。 */
function startRowOf(start: MarkPoint): number {
  return start.col === 0 ? start.row : start.row + 1
}

/** 计算一条命令的输出区间。end 为 null = 运行中（活动区间）。 */
export function computeRange(input: RangeInput): RangeResult {
  // 整屏重画：append-only 历史已不可还原，只冻结当前视口
  if (input.takeover) {
    return {
      startY: input.viewportY,
      rows: input.viewportRows,
      viewport: true,
      degraded: true,
      highWater: input.highWater,
    }
  }

  // 标记所在行被 scrollback 裁掉：无从知道起点，从 buffer 头兜底
  const markLost = input.markRow < 0
  const startY = markLost ? Math.max(0, input.bufferLength - input.viewportRows) : startRowOf(input.start)

  if (input.end) {
    const endExclusive = input.end.col === 0 ? input.end.row : input.end.row + 1
    const rows = Math.max(0, endExclusive - startY)
    return {
      startY,
      rows,
      lastCol: input.end.col > 0 ? input.end.col : undefined,
      viewport: false,
      degraded: markLost,
      highWater: input.highWater,
    }
  }

  // 运行中：结束行取水位线与活动光标的较大值，钳在 buffer 末行内
  const reach = Math.min(Math.max(input.highWater, input.cursorAbsoluteY), input.bufferLength - 1)
  const highWater = Math.max(input.highWater, reach)
  return {
    startY,
    rows: Math.max(1, highWater - startY + 1),
    viewport: false,
    degraded: markLost,
    highWater,
  }
}
