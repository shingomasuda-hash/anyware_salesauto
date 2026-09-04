import type { Db } from "@/db";
import { insertSystemLog } from "@/db/repositories/logs";
import type { Json } from "@/db/types";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogCategory = "search" | "company" | "crawl" | "analysis" | "api" | "job" | "auth" | "system";

export interface LogEntry {
  level: LogLevel;
  category: LogCategory;
  message: string;
  meta?: Record<string, unknown>;
  companyId?: string | null;
  jobId?: string | null;
  jobType?: "search" | "crawl" | "analysis" | null;
}

/**
 * コンソール + system_logs テーブルへの二重出力ロガー。
 * DB書き込みは失敗しても処理を止めない（ログのためにジョブを落とさない）。
 */
export class Logger {
  constructor(
    private readonly db: Db | null,
    private readonly base: Partial<Pick<LogEntry, "category" | "companyId" | "jobId" | "jobType">> = {},
  ) {}

  child(base: Partial<Pick<LogEntry, "category" | "companyId" | "jobId" | "jobType">>): Logger {
    return new Logger(this.db, { ...this.base, ...base });
  }

  debug(message: string, meta?: Record<string, unknown>) {
    return this.write({ level: "debug", category: this.base.category ?? "system", message, meta });
  }
  info(message: string, meta?: Record<string, unknown>) {
    return this.write({ level: "info", category: this.base.category ?? "system", message, meta });
  }
  warn(message: string, meta?: Record<string, unknown>) {
    return this.write({ level: "warn", category: this.base.category ?? "system", message, meta });
  }
  error(message: string, meta?: Record<string, unknown>) {
    return this.write({ level: "error", category: this.base.category ?? "system", message, meta });
  }

  async log(entry: LogEntry) {
    return this.write(entry);
  }

  private async write(entry: LogEntry): Promise<void> {
    const merged: LogEntry = { ...this.base, ...entry };
    const line = `[${merged.level}] [${merged.category}] ${merged.message}`;
    if (merged.level === "error") console.error(line, merged.meta ?? "");
    else if (merged.level === "warn") console.warn(line, merged.meta ?? "");
    else if (process.env.NODE_ENV !== "test") console.log(line, merged.meta ? JSON.stringify(merged.meta).slice(0, 500) : "");

    if (!this.db || merged.level === "debug") return;
    try {
      await insertSystemLog(this.db, {
        level: merged.level,
        category: merged.category,
        message: merged.message.slice(0, 2000),
        meta: (merged.meta ?? null) as Json,
        company_id: merged.companyId ?? null,
        job_id: merged.jobId ?? null,
        job_type: merged.jobType ?? null,
      });
    } catch (err) {
      console.error("[logger] system_logs への書き込みに失敗", err);
    }
  }
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 5).join("\n") };
  }
  return { message: String(err) };
}
