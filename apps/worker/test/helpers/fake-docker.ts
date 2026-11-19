import type {
  ContainerCreateBody,
  ContainerDetails,
  ContainerSummary,
  Docker,
} from "../../src/docker";

interface FakeContainer {
  id: string;
  name: string;
  labels: Record<string, string>;
  body?: ContainerCreateBody;
  removed: boolean;
}

export interface FakeDockerSetup {
  images?: string[];
  networks?: string[];
  probeRunning?: boolean;
  /** What a started container does: keep running, or exit at once. */
  behaviour?: "runs" | "exits";
  logs?: string[];
  existing?: { id: string; name: string; labels: Record<string, string> }[];
}

const running = (id: string, name: string): ContainerDetails => ({
  Id: id,
  Name: `/${name}`,
  RestartCount: 0,
  State: { Status: "running", Running: true, Restarting: false, ExitCode: 0 },
  NetworkSettings: { Networks: { "lift-edge": { IPAddress: "172.18.0.9" } } },
});

/** An in-memory Docker: records every call in `calls`, in order. */
export function fakeDocker(setup: FakeDockerSetup = {}) {
  const calls: string[] = [];
  const networks = new Set(setup.networks ?? ["lift-edge"]);
  const containers = new Map<string, FakeContainer>();
  for (const existing of setup.existing ?? []) {
    containers.set(existing.id, { ...existing, removed: false });
  }
  const find = (idOrName: string) =>
    [...containers.values()].find(
      (container) =>
        !container.removed && (container.id === idOrName || container.name === idOrName),
    );

  const docker = {
    ping: async () => true,
    imageExists: async (image: string) => (setup.images ?? []).includes(image),
    networkExists: async (name: string) => networks.has(name),
    createNetwork: async (name: string, labels: Record<string, string>) => {
      calls.push(`network:${name}:${JSON.stringify(labels)}`);
      networks.add(name);
    },
    removeNetwork: async (name: string) => {
      calls.push(`remove-network:${name}`);
      networks.delete(name);
    },
    createContainer: async (name: string, body: ContainerCreateBody) => {
      const id = `new-${containers.size + 1}`;
      containers.set(id, { id, name, labels: body.Labels, body, removed: false });
      calls.push(`create:${name}`);
      return id;
    },
    startContainer: async (id: string) => {
      calls.push(`start:${id}`);
    },
    inspectContainer: async (idOrName: string): Promise<ContainerDetails | null> => {
      if (idOrName === "lift-probe") {
        return setup.probeRunning === false ? null : running("probe", "lift-probe");
      }
      const container = find(idOrName);
      if (!container) return null;
      if (setup.behaviour === "exits") {
        return {
          ...running(container.id, container.name),
          State: { Status: "exited", Running: false, Restarting: false, ExitCode: 1 },
        };
      }
      return running(container.id, container.name);
    },
    listContainers: async (labels: string[]): Promise<ContainerSummary[]> =>
      [...containers.values()]
        .filter((container) => !container.removed)
        .filter((container) =>
          labels.every((label) => {
            const [key = "", value] = label.split("=");
            return container.labels[key] === value;
          }),
        )
        .map((container) => ({
          Id: container.id,
          Names: [`/${container.name}`],
          Labels: container.labels,
          State: "running",
        })),
    removeContainer: async (idOrName: string) => {
      calls.push(`remove:${idOrName}`);
      const container = find(idOrName);
      if (container) container.removed = true;
    },
    logs: async () => setup.logs ?? [],
    exec: async () => {
      throw new Error("unit tests pass their own probe");
    },
  } satisfies Docker;

  return { docker, calls, containers };
}
