// Removes the app containers and project networks the worker created on this machine (labels
// lift.deployment and lift.project), so `pnpm stack:down` can remove the lift-edge network.
// Development only: on the worker VM, reconciliation (INF-12) owns what runs.
import { execFileSync } from "node:child_process";

if (process.env.NODE_ENV === "production") {
  console.error("clean is for development machines only");
  process.exit(1);
}

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const ids = (output) => output.split("\n").filter(Boolean);

const containers = ids(docker("ps", "--all", "--quiet", "--filter", "label=lift.deployment"));
if (containers.length > 0) docker("rm", "--force", ...containers);

const networks = ids(docker("network", "ls", "--quiet", "--filter", "label=lift.project"));
if (networks.length > 0) docker("network", "rm", ...networks);

console.log(
  `Removed ${containers.length} app container(s) and ${networks.length} project network(s).`,
);
