/**
 * `/usage` — 在 TUI 会话内显示 Coding Plan 配额剩余（5 小时 / 每周）。
 *
 * 复用 usage-command.ts 的 fetchCodingPlanQuota（与 GUI Usage Statistics 相同的接口与 token）。
 */
import type { TuiSubmitPromptResult } from "@zcode/tui";
import { fetchCodingPlanQuota, formatQuotaLines } from "../../usage-command.js";
import type { CommandCenterDeps } from "../types.js";

export async function handleUsageCommand(
  deps: CommandCenterDeps,
): Promise<TuiSubmitPromptResult> {
  try {
    const locale = (await deps.getLocale?.()) ?? "en-US";
    const snapshot = await fetchCodingPlanQuota(process.env);
    return {
      mode: deps.getMode?.(),
      response: formatQuotaLines(snapshot, locale === "zh-CN" ? "zh-CN" : "en-US").join("\n"),
    };
  } catch (error) {
    return {
      mode: deps.getMode?.(),
      response: `Coding Plan quota is unavailable: ${(error as Error).message}`,
    };
  }
}
