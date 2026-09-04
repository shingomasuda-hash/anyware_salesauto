/** PostgreSQL のエラーコードを取り出す（Drizzle は DrizzleQueryError で cause に包む） */
export function getPgErrorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^\d{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function isUniqueViolation(err: unknown): boolean {
  return getPgErrorCode(err) === "23505";
}
