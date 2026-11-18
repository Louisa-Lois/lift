import { z } from "zod";
import { DomainKind, DomainStatus } from "../enums";
import { DomainId, ServiceId } from "../ids";
import { Hostname, Timestamp } from "./common";

/** `GET /services/:id/domains`. The generated domain is created with its service, `active`. */
export const Domain = z.object({
  id: DomainId,
  serviceId: ServiceId,
  hostname: Hostname,
  kind: DomainKind,
  status: DomainStatus,
  verifiedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type Domain = z.infer<typeof Domain>;

/** `POST /services/:id/domains`: a custom domain, `pending` until verified (cut list). */
export const CreateDomainBody = z.strictObject({ hostname: Hostname });
export type CreateDomainBody = z.infer<typeof CreateDomainBody>;
