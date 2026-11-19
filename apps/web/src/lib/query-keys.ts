/** Every TanStack Query key, from one place (docs/prd/02-frontend.md, "Talking to the API"). */
export const queryKeys = {
  me: ["me"] as const,
  projects: ["projects"] as const,
  project: (projectId: string) => ["project", projectId] as const,
  service: (serviceId: string) => ["service", serviceId] as const,
  deployments: (serviceId: string) => ["deployments", serviceId] as const,
  deployment: (deploymentId: string) => ["deployment", deploymentId] as const,
  variables: (serviceId: string) => ["variables", serviceId] as const,
  /** Under `variables`, so invalidating a service's variables refetches these too. */
  revealedVariables: (serviceId: string) => ["variables", serviceId, "revealed"] as const,
  databases: (projectId: string) => ["databases", projectId] as const,
  usage: (projectId: string) => ["usage", projectId] as const,
  tokens: ["tokens"] as const,
  githubRepos: (query: string) => ["github", "repos", query] as const,
  githubBranches: (owner: string, repo: string) => ["github", "branches", owner, repo] as const,
};
