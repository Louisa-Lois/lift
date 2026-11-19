import pc from "picocolors";
import { toCliError } from "./errors";

export interface OutputContext {
  json?: boolean;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export function printJson(data: unknown, ctx?: OutputContext): void {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (ctx?.stdout) {
    ctx.stdout(text);
  } else {
    process.stdout.write(text);
  }
}

export function printText(text: string, ctx?: OutputContext): void {
  const line = `${text}\n`;
  if (ctx?.stdout) {
    ctx.stdout(line);
  } else {
    process.stdout.write(line);
  }
}

export function printError(error: unknown, ctx?: OutputContext): void {
  const cliError = toCliError(error);
  const isJson = ctx?.json ?? false;

  let msg: string;
  if (isJson) {
    msg = `${cliError.message}\n`;
    if (cliError.suggestion && !cliError.message.includes(cliError.suggestion)) {
      msg += `${cliError.suggestion}\n`;
    }
  } else {
    const prefix = pc.red("error:");
    msg = `${prefix} ${cliError.message}\n`;
    if (cliError.suggestion && !cliError.message.includes(cliError.suggestion)) {
      msg += `${pc.cyan("hint:")} ${cliError.suggestion}\n`;
    }
  }

  if (ctx?.stderr) {
    ctx.stderr(msg);
  } else {
    process.stderr.write(msg);
  }
}

export function renderTable(headers: string[], rows: string[][]): string {
  const columnWidths = headers.map((h, i) => {
    let max = h.length;
    for (const row of rows) {
      const cell = row[i] ?? "";
      if (cell.length > max) {
        max = cell.length;
      }
    }
    return max;
  });

  const headerLine = headers
    .map((h, i) => {
      const width = columnWidths[i] ?? h.length;
      return h.toUpperCase().padEnd(width + 2);
    })
    .join("")
    .trimEnd();

  const dataLines = rows.map((row) =>
    row
      .map((cell, i) => {
        const width = columnWidths[i] ?? (cell ?? "").length;
        return (cell ?? "").padEnd(width + 2);
      })
      .join("")
      .trimEnd(),
  );

  return [headerLine, ...dataLines].join("\n");
}
