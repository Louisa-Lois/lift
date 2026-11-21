import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { browserOf, cspReportLog, violationsOf } from "../../services/csp-reports";

/** A report is about 1 KB; Chrome batches a few. */
const BODY_LIMIT = 64 * 1024;

/**
 * The dashboard's Content-Security-Policy violation reports (apps/web/src/lib/csp.ts). Public:
 * browsers send them without a session. Each violation is logged at warn and never stored; the
 * answer is always 204, which browsers don't read. Hidden from the OpenAPI document: it's for
 * browsers, not API clients.
 */
export const cspReportRoutes: FastifyPluginAsyncZod = async (app) => {
  // Browsers send JSON under their own media types; this plugin reads them as JSON.
  app.addContentTypeParser(
    ["application/csp-report", "application/reports+json"],
    { parseAs: "string", bodyLimit: BODY_LIMIT },
    app.getDefaultJsonParser("error", "error"),
  );
  const reports = cspReportLog();

  app.post(
    "/csp-reports",
    { config: { public: true }, bodyLimit: BODY_LIMIT, schema: { hide: true } },
    async (request, reply) => {
      reports.record(
        request.log,
        violationsOf(request.body),
        browserOf(request.headers["user-agent"]),
      );
      return reply.code(204).send();
    },
  );
};
