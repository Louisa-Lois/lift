import { describe, expect, it } from "vitest";
import { CLI_VERSION, createProgram } from "../src/program";

function run(args: string[]) {
  const output: string[] = [];
  const program = createProgram()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => output.push(text),
      writeErr: (text) => output.push(text),
    });
  const result = program.parseAsync(["node", "lift", ...args]);
  return { result, output };
}

describe("lift", () => {
  it("prints its version", async () => {
    const { result, output } = run(["--version"]);
    await expect(result).rejects.toMatchObject({ code: "commander.version" });
    expect(output.join("")).toContain(CLI_VERSION);
  });

  it("fails with exit code 1 on input it doesn't understand", async () => {
    const { result, output } = run(["fly-to-the-moon"]);
    await expect(result).rejects.toMatchObject({ exitCode: 1 });
    expect(output.join("")).toMatch(/^error: /);
  });
});
