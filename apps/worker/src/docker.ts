import { existsSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";

/** Engine API 1.44: the oldest Docker 29 accepts, and what this client is written against. */
const API = "/v1.44";

/**
 * Where the Docker daemon listens: DOCKER_HOST when it is a unix socket, otherwise the standard
 * socket (the worker VM mounts it), otherwise Docker Desktop's on a Mac.
 */
export function dockerSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DOCKER_HOST?.startsWith("unix://")) return env.DOCKER_HOST.slice("unix://".length);
  const candidates = [
    "/var/run/docker.sock",
    path.join(homedir(), ".docker", "run", "docker.sock"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "/var/run/docker.sock";
}

export class DockerApiError extends Error {
  override readonly name = "DockerApiError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Splits Docker's multiplexed stream (each frame: stream type, 3 zero bytes, a 4-byte size, then
 * the bytes) into text, in the order it was written.
 */
export function demux(buffer: Buffer): { stdout: string; stderr: string; text: string } {
  let stdout = "";
  let stderr = "";
  let text = "";
  for (let offset = 0; offset + 8 <= buffer.length; ) {
    const size = buffer.readUInt32BE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + size).toString("utf8");
    if (buffer[offset] === 2) stderr += chunk;
    else stdout += chunk;
    text += chunk;
    offset += 8 + size;
  }
  return { stdout, stderr, text };
}

export interface ContainerSummary {
  Id: string;
  Names: string[];
  Labels: Record<string, string>;
  State: string;
}

export interface ContainerDetails {
  Id: string;
  Name: string;
  RestartCount: number;
  State: {
    Status: string;
    Running: boolean;
    Restarting: boolean;
    ExitCode: number;
    OOMKilled: boolean;
  };
  NetworkSettings: { Networks: Record<string, { IPAddress: string }> };
  HostConfig?: { RestartPolicy?: { Name: string } };
}

/** The body of `POST /containers/create`, as far as Lift sets it. */
export interface ContainerCreateBody {
  Image: string;
  Env: string[];
  Labels: Record<string, string>;
  HostConfig: Record<string, unknown>;
  NetworkingConfig: { EndpointsConfig: Record<string, { Aliases?: string[] }> };
}

/**
 * The few Docker Engine API calls the worker makes, over the unix socket. Environment values go
 * in JSON bodies, never in a command line or a file.
 */
export function createDocker(socketPath: string = dockerSocketPath()) {
  function send(
    method: string,
    apiPath: string,
    body?: unknown,
    timeoutMs = 30_000,
  ): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const request = http.request(
        {
          socketPath,
          method,
          path: `${API}${apiPath}`,
          headers: payload
            ? { "content-type": "application/json", "content-length": payload.length }
            : {},
          timeout: timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
          );
          response.on("error", reject);
        },
      );
      request.on("timeout", () =>
        request.destroy(new Error(`Docker didn't answer ${method} ${apiPath}`)),
      );
      request.on("error", reject);
      if (payload) request.write(payload);
      request.end();
    });
  }

  async function call(
    method: string,
    apiPath: string,
    ok: number[],
    body?: unknown,
    timeoutMs?: number,
  ): Promise<{ status: number; body: Buffer }> {
    const response = await send(method, apiPath, body, timeoutMs);
    if (!ok.includes(response.status)) {
      let message = response.body.toString("utf8");
      try {
        message = (JSON.parse(message) as { message?: string }).message ?? message;
      } catch {
        // Not JSON: keep the text.
      }
      throw new DockerApiError(
        `Docker refused ${method} ${apiPath}: ${message.trim()}`,
        response.status,
      );
    }
    return response;
  }

  const json = <T>(response: { body: Buffer }) => JSON.parse(response.body.toString("utf8")) as T;

  return {
    async ping(): Promise<boolean> {
      try {
        return (await send("GET", "/_ping", undefined, 5_000)).status === 200;
      } catch {
        return false;
      }
    },

    async imageExists(image: string): Promise<boolean> {
      return (await call("GET", `/images/${image}/json`, [200, 404])).status === 200;
    },

    async networkExists(name: string): Promise<boolean> {
      return (
        (await call("GET", `/networks/${encodeURIComponent(name)}`, [200, 404])).status === 200
      );
    },

    /** Creates a bridge network; one that already exists (409) is fine. */
    async createNetwork(name: string, labels: Record<string, string>): Promise<void> {
      await call("POST", "/networks/create", [201, 409], {
        Name: name,
        Driver: "bridge",
        Labels: labels,
      });
    },

    /** Removes a network; one that is already gone is fine. */
    async removeNetwork(name: string): Promise<void> {
      await call("DELETE", `/networks/${encodeURIComponent(name)}`, [204, 404]);
    },

    async createContainer(name: string, body: ContainerCreateBody): Promise<string> {
      const response = await call(
        "POST",
        `/containers/create?name=${encodeURIComponent(name)}`,
        [201],
        body,
      );
      return json<{ Id: string }>(response).Id;
    },

    /** Changes a container's restart policy in place (`docker update --restart`). */
    async setRestartPolicy(id: string, name: "no" | "unless-stopped"): Promise<void> {
      await call("POST", `/containers/${encodeURIComponent(id)}/update`, [200], {
        RestartPolicy: { Name: name },
      });
    },

    async startContainer(id: string): Promise<void> {
      await call("POST", `/containers/${id}/start`, [204, 304]);
    },

    async inspectContainer(id: string): Promise<ContainerDetails | null> {
      const response = await call("GET", `/containers/${encodeURIComponent(id)}/json`, [200, 404]);
      return response.status === 404 ? null : json<ContainerDetails>(response);
    },

    /** Containers, running or not, carrying every given `key=value` label. */
    async listContainers(labels: string[]): Promise<ContainerSummary[]> {
      const filters = encodeURIComponent(JSON.stringify({ label: labels }));
      return json<ContainerSummary[]>(
        await call("GET", `/containers/json?all=true&filters=${filters}`, [200]),
      );
    },

    /**
     * Stops a container gracefully: SIGTERM, then SIGKILL after `seconds`. The process exits while
     * its network is still up, so its connections close cleanly. One already stopped or gone is fine.
     */
    async stopContainer(id: string, seconds: number): Promise<void> {
      await call(
        "POST",
        `/containers/${encodeURIComponent(id)}/stop?t=${seconds}`,
        [204, 304, 404],
        undefined,
        (seconds + 30) * 1000,
      );
    },

    /** Stops and removes a container; one that is already gone is fine. */
    async removeContainer(id: string): Promise<void> {
      await call("DELETE", `/containers/${encodeURIComponent(id)}?force=true`, [204, 404]);
    },

    /** The container's last `tail` lines of output, stdout and stderr in order. */
    async logs(id: string, tail: number): Promise<string[]> {
      const response = await call(
        "GET",
        `/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&tail=${tail}`,
        [200],
      );
      const lines = demux(response.body).text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      return lines;
    },

    /** Runs a command in a running container and waits for it (the health probe). */
    async exec(
      container: string,
      command: string[],
      timeoutMs: number,
    ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
      const created = await call(
        "POST",
        `/containers/${encodeURIComponent(container)}/exec`,
        [201],
        {
          AttachStdout: true,
          AttachStderr: true,
          Cmd: command,
        },
      );
      const { Id } = json<{ Id: string }>(created);
      const started = await call(
        "POST",
        `/exec/${Id}/start`,
        [200],
        { Detach: false, Tty: false },
        timeoutMs,
      );
      const output = demux(started.body);
      const inspected = json<{ ExitCode: number | null }>(
        await call("GET", `/exec/${Id}/json`, [200]),
      );
      return { exitCode: inspected.ExitCode, stdout: output.stdout, stderr: output.stderr };
    },
  };
}

export type Docker = ReturnType<typeof createDocker>;
