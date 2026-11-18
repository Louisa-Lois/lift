import { z } from "zod";
import { MetricsWindow } from "../enums";
import { ProjectId, ServiceId } from "../ids";
import { ResourceName, Timestamp } from "./common";

/** The worker samples every running container this often. */
export const METRICS_INTERVAL_SECONDS = 15;

/**
 * One sample from the worker. `cpuPct` is a percentage of the service's CPU limit (0–100);
 * `netRxKb` and `netTxKb` are KB moved during the 15-second interval, not running totals.
 */
export const MetricSample = z.object({
  serviceId: ServiceId,
  ts: Timestamp,
  cpuPct: z.number().min(0),
  memMb: z.number().min(0),
  netRxKb: z.number().min(0),
  netTxKb: z.number().min(0),
});
export type MetricSample = z.infer<typeof MetricSample>;

export const MetricsQuery = z.object({ window: MetricsWindow.default("1h") });
export type MetricsQuery = z.infer<typeof MetricsQuery>;

/** One minute: CPU and memory averaged, network summed over the minute. */
export const MetricPoint = MetricSample.omit({ serviceId: true });
export type MetricPoint = z.infer<typeof MetricPoint>;

/** `GET /services/:id/metrics?window=1h|6h|24h`, oldest minute first. */
export const ServiceMetrics = z.object({
  serviceId: ServiceId,
  window: MetricsWindow,
  points: z.array(MetricPoint),
});
export type ServiceMetrics = z.infer<typeof ServiceMetrics>;

export const UsageQuery = z.object({ from: Timestamp.optional(), to: Timestamp.optional() });
export type UsageQuery = z.infer<typeof UsageQuery>;

const UsageTotals = z.object({
  vcpuHours: z.number().min(0),
  gbHours: z.number().min(0),
  estimatedCostUsd: z.number().min(0),
});

export const ServiceUsage = UsageTotals.extend({ serviceId: ServiceId, serviceName: ResourceName });
export type ServiceUsage = z.infer<typeof ServiceUsage>;

/** `GET /projects/:id/usage?from=&to=`. Prices are illustrative, and the UI says so. */
export const ProjectUsage = z.object({
  projectId: ProjectId,
  from: Timestamp,
  to: Timestamp,
  services: z.array(ServiceUsage),
  total: UsageTotals,
  pricing: z.object({
    vcpuHourUsd: z.number().min(0),
    gbHourUsd: z.number().min(0),
    illustrative: z.literal(true),
  }),
});
export type ProjectUsage = z.infer<typeof ProjectUsage>;
