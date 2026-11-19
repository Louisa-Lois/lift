import { schema } from "@lift/db";
import { ServiceId } from "@lift/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problem } from "../../lib/problem";
import type { SecretBox } from "../../services/crypto";
import { deployPush, type PushEvent, signatureMatches } from "../../services/webhooks";

/** GitHub caps deliveries at 25 MB; real pushes are far smaller. */
const BODY_LIMIT = 10 * 1024 * 1024;
/** How long a delivery waits for a webhook's secret that is being saved. */
const SECRET_WAIT_MS = 2_000;

/**
 * BE-08: GitHub's push events for one service (`?service=svc_…`), public but signed. The
 * signature is checked against the service's own secret before anything else; `ping` answers
 * 200; a push to the service's branch queues a deployment once per commit. Every answer is plain
 * text for GitHub's delivery log.
 */
export const webhookRoutes: FastifyPluginAsyncZod<{ secretBox: SecretBox | null }> = async (
  app,
  { secretBox },
) => {
  // GitHub signs the exact bytes it sends, so in this plugin JSON stays a raw Buffer.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: BODY_LIMIT },
    (_request, body, done) => done(null, body),
  );

  app.post(
    "/webhooks/github",
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        summary: "GitHub push events for a service (signature-checked)",
        description:
          "Set up by Lift when a service is created. Answers 401 to a bad signature, 200 to `ping`, and 202 to everything else.",
        tags: ["webhooks"],
        querystring: z.object({ service: ServiceId }),
      },
    },
    async (request, reply) => {
      const find = async () => {
        const [found] = await app.db
          .select()
          .from(schema.services)
          .where(
            and(eq(schema.services.id, request.query.service), isNull(schema.services.deletedAt)),
          );
        return found;
      };
      // GitHub pings a webhook the moment it exists, which can be just before Lift has saved its
      // secret (ensureWebhook stores it once GitHub answers): give that a moment.
      let service = await find();
      for (let waited = 0; service && !service.webhookSecretEnc && waited < SECRET_WAIT_MS; ) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        waited += 200;
        service = await find();
      }
      if (!service?.webhookSecretEnc || !secretBox) {
        throw problem("not_found", "No webhook for this service.");
      }
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const secret = secretBox.decrypt(service.webhookSecretEnc);
      if (!signatureMatches(secret, body, request.headers["x-hub-signature-256"])) {
        throw problem("unauthenticated", "The signature doesn't match this service's webhook.");
      }

      const event = request.headers["x-github-event"];
      reply.type("text/plain; charset=utf-8");
      if (event === "ping") return reply.code(200).send("Lift is listening for pushes.");
      if (event !== "push")
        return reply.code(202).send(`Ignored: Lift deploys on push, not ${event}.`);

      let push: PushEvent;
      try {
        push = JSON.parse(body.toString("utf8")) as PushEvent;
      } catch {
        throw problem("validation_failed", "The push payload isn't JSON.");
      }
      const outcome = await deployPush(
        { db: app.db, redis: app.redis, queues: app.queues, log: request.log },
        service,
        push,
      );
      request.log.info(
        { serviceId: service.id, deploymentId: outcome.deploymentId },
        "push webhook handled",
      );
      return reply.code(202).send(outcome.message);
    },
  );
};
