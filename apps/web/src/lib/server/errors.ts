import "server-only";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fields: string[] = [], readonly retryAfterS = 0, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

// Store errors that mean "not there" answer 404.
const MISSING: Record<string, string> = {
  version_not_found: "No saved scenario version with this ID.",
  scenario_not_found: "No scenario with this ID.",
};

export function errorResponse(error: unknown) {
  if (error instanceof Error && MISSING[error.message]) error = new ApiError(404, error.message, MISSING[error.message]);
  if (error instanceof ApiError) {
    const headers: Record<string, string> = error.retryAfterS ? { "Retry-After": String(error.retryAfterS) } : {};
    return Response.json({ error: { code: error.code, message: error.message, fields: error.fields, ...error.extra, ...(error.retryAfterS ? { retry_after_s: error.retryAfterS } : {}) } }, { status: error.status, headers });
  }
  const code = error instanceof Error ? error.message.split(":")[0] : "error";
  return Response.json({ error: { code, message: "Request failed.", fields: [] } }, { status: 400 });
}
