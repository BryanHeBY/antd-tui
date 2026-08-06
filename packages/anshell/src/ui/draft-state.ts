import type { CompletionItem, SyntaxDiagnostic } from "../shell"

export interface DraftState {
  input: string
  /** Ctrl+T 强制的路由；null = 自动判断。command 用来在绝对路径与斜杠命令间取舍。 */
  routeOverride: "shell" | "agent" | "command" | null
  diagnostic: SyntaxDiagnostic | null
  completions: CompletionItem[]
  /** 补全下拉框是否展开（有候选且未按 Esc 收起） */
  completionOpen: boolean
  /** 补全下拉框选中项下标 */
  completionIndex: number
  /** 斜杠候选菜单是否展开；Esc 关掉后要等下次输入变化才重开 */
  menuOpen: boolean
  /** 菜单选中项下标（候选表由输入派生，只有下标属于草稿状态） */
  menuIndex: number
}

export type DraftAction =
  | { type: "change"; input: string }
  | { type: "reset" }
  | { type: "route"; route: DraftState["routeOverride"] }
  | { type: "diagnostic"; diagnostic: SyntaxDiagnostic | null }
  | { type: "completions"; completions: CompletionItem[] }
  | { type: "completionMove"; delta: number; count: number }
  | { type: "completionClose" }
  | { type: "menuMove"; delta: number; count: number }
  | { type: "menuClose" }

export const initialDraftState: DraftState = {
  input: "",
  routeOverride: null,
  diagnostic: null,
  completions: [],
  completionOpen: false,
  completionIndex: 0,
  menuOpen: false,
  menuIndex: 0,
}

/** 保证输入、分诊覆盖和派生提示在提交/取消时作为一个整体更新。 */
export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "change":
      return {
        ...state,
        input: action.input,
        diagnostic: null,
        completions: [],
        completionOpen: false,
        completionIndex: 0,
        // 只要还在敲斜杠命令就重新展开菜单；下标回到首项，避免停在越界位置
        menuOpen: action.input.trimStart().startsWith("/"),
        menuIndex: 0,
      }
    case "reset":
      return initialDraftState
    case "route":
      return { ...state, routeOverride: action.route, diagnostic: null, completions: [] }
    case "diagnostic":
      return { ...state, diagnostic: action.diagnostic }
    case "completions":
      return {
        ...state,
        completions: action.completions,
        completionOpen: action.completions.length > 0,
        completionIndex: 0,
      }
    case "completionMove": {
      if (action.count <= 0) return state
      const next = (state.completionIndex + action.delta + action.count) % action.count
      return { ...state, completionIndex: next }
    }
    case "completionClose":
      return { ...state, completions: [], completionOpen: false, completionIndex: 0 }
    case "menuMove": {
      if (action.count <= 0) return state
      const next = (state.menuIndex + action.delta + action.count) % action.count
      return { ...state, menuIndex: next }
    }
    case "menuClose":
      return { ...state, menuOpen: false, menuIndex: 0 }
  }
}
