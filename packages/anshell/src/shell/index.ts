export {
  lexShell,
  SHELL_BUILTINS,
  toCodePointOffset,
  toUtf16Offset,
  unquoteShellWord,
  type ShellLexResult,
  type ShellToken,
  type ShellTokenKind,
} from "./lexer"
export { checkShellSyntax, resolveShell, type SyntaxDiagnostic } from "./syntax"
export {
  resolveShellDialect,
  unsupportedShellMessage,
  type ShellDialect,
  type ResolvedShell,
} from "./dialect"
export {
  bashRcSource,
  zshRcSources,
  writeShellRc,
  type ShellInit,
  type ShellRcOptions,
  type ShellLaunch,
} from "./rc"
export {
  createShellSession,
  type ShellSession,
  type ShellSessionOptions,
  type ShellSessionEvents,
  type ShellState,
  type CommandStart,
  type CommandEnd,
} from "./session"
export {
  computeRange,
  type RangeInput,
  type RangeResult,
  type MarkPoint,
} from "./range"
export {
  commonPrefix,
  completeShellInput,
  type CompletionItem,
  type CompletionResult,
} from "./completion"
