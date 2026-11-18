import { z } from "zod";
import { Builder, ServiceType } from "../enums";
import { DeploymentId, ProjectId, ServiceId } from "../ids";
import {
  BranchName,
  Cpu,
  FilePath,
  HealthcheckPath,
  MemoryMb,
  Port,
  RepoRef,
  RepoWithBranch,
  ResourceName,
  RootDir,
  Slug,
  Subdomain,
  Timestamp,
} from "./common";
import { DeploymentSummary } from "./deployment";

/** Defaults for a new service (docs/prd/01-backend-api.md, `services` table, and BE-00). */
export const SERVICE_DEFAULTS = {
  type: "web",
  rootDir: ".",
  builder: "railpack",
  port: 3000,
  healthcheckPath: "/",
  cpu: 0.5,
  memoryMb: 512,
  autofix: true,
} as const;

/**
 * A service built from a GitHub repo. Settings changes apply on the next deploy. `url`,
 * `latestDeployment` and `activeDeploymentId` are read-only, computed by the API so cards can show
 * a status without another request.
 */
export const Service = z.object({
  id: ServiceId,
  projectId: ProjectId,
  name: ResourceName,
  /** Never changes after creation, even when the service is renamed. */
  slug: Slug,
  type: ServiceType,
  repo: RepoWithBranch,
  rootDir: RootDir,
  builder: Builder,
  dockerfilePath: FilePath.nullable(),
  buildCommand: z.string().nullable(),
  startCommand: z.string().nullable(),
  port: Port,
  healthcheckPath: HealthcheckPath,
  cpu: Cpu,
  memoryMb: MemoryMb,
  /** `{service-slug}-{project-slug}`; never changes after creation. */
  subdomain: Subdomain,
  autofix: z.boolean(),
  /** The generated domain's URL, e.g. `https://web-demo-shop.apps.example.com`. */
  url: z.url(),
  latestDeployment: DeploymentSummary.nullable(),
  /** The deployment serving traffic; it can be older than `latestDeployment`. */
  activeDeploymentId: DeploymentId.nullable(),
  createdAt: Timestamp,
});
export type Service = z.infer<typeof Service>;

/**
 * `POST /projects/:id/services`. Also creates the push webhook and the generated domain; with
 * `deploy: true` it deploys the branch head (`trigger: manual`). Other settings go through PATCH.
 */
export const CreateServiceBody = z.strictObject({
  name: ResourceName,
  repo: RepoRef,
  branch: BranchName,
  rootDir: RootDir.optional(),
  builder: Builder.optional(),
  port: Port.optional(),
  deploy: z.boolean().optional(),
});
export type CreateServiceBody = z.infer<typeof CreateServiceBody>;

const Command = z.string().trim().min(1).max(1000);

/** Every setting PATCH can change. The repo, slug and subdomain can't change. */
export const ServiceSettings = z.strictObject({
  name: ResourceName,
  type: ServiceType,
  branch: BranchName,
  rootDir: RootDir,
  builder: Builder,
  dockerfilePath: FilePath.nullable(),
  buildCommand: Command.nullable(),
  startCommand: Command.nullable(),
  port: Port,
  healthcheckPath: HealthcheckPath,
  cpu: Cpu,
  memoryMb: MemoryMb,
  autofix: z.boolean(),
});
export type ServiceSettings = z.infer<typeof ServiceSettings>;

/** `PATCH /services/:id`: any subset of the settings, applied on the next deploy. */
export const UpdateServiceBody = ServiceSettings.partial().refine(
  (body) => Object.keys(body).length > 0,
  "Change at least one setting",
);
export type UpdateServiceBody = z.infer<typeof UpdateServiceBody>;
