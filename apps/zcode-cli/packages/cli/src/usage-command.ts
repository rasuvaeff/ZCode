/**
 * `zcode usage` — 在终端显示 Coding Plan 配额剩余（5 小时 / 每周）。
 *
 * 使用与 GUI（Usage Statistics → Coding Plan）相同的接口：
 * GET {ZAI_QUOTA_URL}，Authorization 头直接携带 zai access token（无 Bearer 前缀）。
 * token 从共享凭据库读取，由 `zcode login zai` 写入。
 * 查询与格式化逻辑抽到 fetchCodingPlanQuota/formatQuotaLines，
 * 供 TUI 内的 `/usage` 斜杠命令（handlers/usage.ts）复用。
 */
import { color, formatJson, supportsColor } from "@zcode/core";
import type { GlobalOptions, RunContext } from "@zcode/shared-types";
import { loadSharedZCodeCredential } from "@zcode/adapters/auth";
import { loadCliDotenv } from "./env.js";
import type { RunDependencies } from "./cli-types.js";

const ZAI_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const ZAI_ACCESS_TOKEN_KEY = "oauth:zai:access_token";

export interface QuotaLimitPayload {
  type: string;
  unit?: number;
  number?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  /** 已使用占比 0-100（GUI 显示的剩余 = 100 - percentage）。 */
  percentage?: number;
  nextResetTime?: number;
}

export interface QuotaSnapshot {
  level: string | null;
  limits: QuotaLimitPayload[];
}

interface QuotaResponse {
  code: number;
  msg?: string;
  success?: boolean;
  data?: {
    level?: string | null;
    limits?: QuotaLimitPayload[];
  };
}

const formatResetTime = (epochMs: number | undefined, locale: string): string => {
  if (!epochMs) return "unknown";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  }).format(new Date(epochMs));
};

/** unit=3/number=5 为 5 小时窗口；unit=6 为每周窗口。其余类型不展示。 */
const limitLabel = (limit: QuotaLimitPayload): string | null => {
  if (limit.type !== "CREDIT_LIMIT") return null;
  if (limit.unit === 6) return "week";
  if (limit.unit === 3 && limit.number === 5) return "5 hours";
  return null;
};

export const formatQuotaLines = (snapshot: QuotaSnapshot, locale: string): string[] => {
  const lines = [`plan: ${snapshot.level ?? "unknown"}`];
  const limits = snapshot.limits.filter((limit) => limitLabel(limit) !== null);
  for (const limit of limits) {
    const label = limitLabel(limit);
    if (!label) continue;
    const remainingPercent = 100 - (limit.percentage ?? 0);
    lines.push(
      `${label}: ${remainingPercent}% remaining` +
        ` (${limit.currentValue ?? 0} used of ${limit.usage ?? 0})` +
        ` — resets ${formatResetTime(limit.nextResetTime, locale)}`,
    );
  }
  if (limits.length === 0) lines.push("no credit limits reported");
  return lines;
};

/** 查询配额；失败时抛出带可读信息的 Error。 */
export async function fetchCodingPlanQuota(env: NodeJS.ProcessEnv): Promise<QuotaSnapshot> {
  const token = await loadSharedZCodeCredential(ZAI_ACCESS_TOKEN_KEY, { env });
  if (!token) {
    throw new Error("Not logged in to Z.ai. Run: zcode login zai");
  }
  const quotaUrl = env.ZCODE_QUOTA_URL?.trim() || ZAI_QUOTA_URL;
  const res = await fetch(quotaUrl, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Quota request failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as QuotaResponse;
  if (!body.success || !body.data) {
    throw new Error(`Quota request failed: ${body.msg ?? `code ${body.code}`}`);
  }
  return {
    level: body.data.level ?? null,
    limits: body.data.limits ?? [],
  };
}

export async function runUsageCommand(
  ctx: RunContext,
  options: GlobalOptions,
  deps: RunDependencies,
): Promise<number> {
  const env = deps.env ?? process.env;
  const workingDirectory = (deps.cwd ?? (() => process.cwd()))();
  const dotenvResult = (deps.loadDotenv ?? loadCliDotenv)({ cwd: workingDirectory, env });
  if (dotenvResult.error) {
    throw new Error(`Failed to load environment file: ${dotenvResult.path}`, {
      cause: dotenvResult.error,
    });
  }

  const snapshot = await fetchCodingPlanQuota(env);

  if (options.json) {
    ctx.stdout.write(
      formatJson({
        level: snapshot.level,
        limits: snapshot.limits.map((limit) => ({ ...limit })),
      }),
    );
    return 0;
  }

  const colors = supportsColor(ctx.stdout, options.noColor);
  const locale = options.locale === "zh-CN" ? "zh-CN" : "en-US";
  ctx.stdout.write(`${color.bold("zcode usage", colors)}\n`);
  ctx.stdout.write(formatQuotaLines(snapshot, locale).join("\n") + "\n");

  return 0;
}
