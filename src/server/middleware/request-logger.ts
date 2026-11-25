import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "../../logger.js";
import type { Clock } from "../../ports.js";

export function createRequestLoggerMiddleware(logger: Logger, clock: Clock): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? randomUUID();
    const startMs = clock.nowMs();
    c.header("x-request-id", requestId);
    await next();
    logger.info("http_request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: clock.nowMs() - startMs,
    });
  };
}
