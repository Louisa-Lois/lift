"use client";

import {
  isReservedVariableKey,
  type StoredVariableSource,
  VARIABLE_KEY_PATTERN,
  VARIABLE_VALUE_MAX_LENGTH,
  type Variable,
} from "@lift/shared";
import { EyeIcon, EyeOffIcon, PencilIcon, PlusIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Staged edits: a value sets the key, null deletes it. Nothing is sent until Save. */
export type VariableChanges = Record<string, string | null>;

const SOURCE: Record<StoredVariableSource, string> = {
  user: "you",
  database: "database",
  agent: "agent",
};

/** Why a key can't be added, or null when it can. */
export function keyProblem(key: string): string | null {
  if (key === "") return "Enter a key";
  if (!VARIABLE_KEY_PATTERN.test(key) || key.length > 255) {
    return "Use A-Z, 0-9 and _, like DATABASE_URL";
  }
  if (isReservedVariableKey(key)) {
    return key === "PORT"
      ? "PORT is set by Lift: change the service's port instead"
      : "Keys starting LIFT_ are Lift's";
  }
  return null;
}

export interface EnvTableProps {
  /** The service's variables as stored, values masked. */
  variables: Variable[];
  /** Plaintext values by key, once an editor has revealed them; undefined until then. */
  revealed: Record<string, string> | undefined;
  /** Asks for the plaintext values (editors only). */
  onReveal: () => void;
  canEdit: boolean;
  changes: VariableChanges;
  onChange: (changes: VariableChanges) => void;
  /** The API's message for a key, from the last failed save. */
  errors: Record<string, string>;
}

/**
 * The Variables table (docs/prd/02-frontend.md, "Variables tab"): KEY, the value masked with an
 * eye to reveal it (editors), where it came from, and delete. Edits stay staged in `changes`.
 */
export function EnvTable({
  variables,
  revealed,
  onReveal,
  canEdit,
  changes,
  onChange,
  errors,
}: EnvTableProps) {
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const stored = new Map(variables.map((variable) => [variable.key, variable]));
  const added = Object.keys(changes)
    .filter((key) => !stored.has(key) && changes[key] !== null)
    .sort();

  const stage = (key: string, value: string | null) => onChange({ ...changes, [key]: value });
  const unstage = (key: string) => {
    const { [key]: _dropped, ...rest } = changes;
    onChange(rest);
  };
  const toggleShown = (key: string) => {
    if (!revealed) onReveal();
    const next = new Set(shown);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setShown(next);
  };

  function add(event: FormEvent) {
    event.preventDefault();
    const key = newKey.trim();
    const problem = keyProblem(key);
    if (problem) {
      setAddError(problem);
      return;
    }
    if (newValue.length > VARIABLE_VALUE_MAX_LENGTH) {
      setAddError("A value can be at most 32 KB");
      return;
    }
    stage(key, newValue);
    setNewKey("");
    setNewValue("");
    setAddError(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {variables.length === 0 && added.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
          No variables yet.{canEdit ? " Add one below, or paste a .env file." : ""}
        </p>
      ) : (
        <ul aria-label="Variables" className="divide-y rounded-lg border">
          {variables.map((variable) => {
            const change = changes[variable.key];
            const plain = revealed?.[variable.key];
            const visible = shown.has(variable.key) && plain !== undefined;
            return (
              <li key={variable.key} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex items-center gap-3">
                  <code className="w-56 shrink-0 truncate font-medium font-mono text-xs">
                    {variable.key}
                  </code>
                  <div className="min-w-0 flex-1">
                    {change === null ? (
                      <span className="font-mono text-muted-foreground text-xs line-through">
                        {variable.value}
                      </span>
                    ) : typeof change === "string" ? (
                      <Input
                        aria-label={`New value for ${variable.key}`}
                        value={change}
                        placeholder="The new value"
                        onChange={(event) => stage(variable.key, event.target.value)}
                        className="h-7 font-mono text-xs"
                        spellCheck={false}
                        autoComplete="off"
                      />
                    ) : (
                      <span className="block truncate font-mono text-xs">
                        {visible ? plain : variable.value}
                      </span>
                    )}
                  </div>
                  <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                    {change === null
                      ? "deleting"
                      : change !== undefined
                        ? "edited"
                        : SOURCE[variable.source]}
                  </Badge>
                  {canEdit ? (
                    <div className="flex shrink-0 items-center">
                      {change === undefined ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${visible ? "Hide" : "Show"} ${variable.key}`}
                            aria-pressed={visible}
                            onClick={() => toggleShown(variable.key)}
                          >
                            {visible ? <EyeOffIcon /> : <EyeIcon />}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${variable.key}`}
                            onClick={() => stage(variable.key, plain ?? "")}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${variable.key}`}
                            onClick={() => stage(variable.key, null)}
                          >
                            <Trash2Icon />
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Undo the change to ${variable.key}`}
                          onClick={() => unstage(variable.key)}
                        >
                          <Undo2Icon />
                          Undo
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
                {errors[variable.key] ? (
                  <p className="text-destructive text-xs">{errors[variable.key]}</p>
                ) : null}
              </li>
            );
          })}
          {added.map((key) => (
            <li key={key} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex items-center gap-3">
                <code className="w-56 shrink-0 truncate font-medium font-mono text-xs">{key}</code>
                <div className="min-w-0 flex-1">
                  <Input
                    aria-label={`Value for ${key}`}
                    value={changes[key] ?? ""}
                    onChange={(event) => stage(key, event.target.value)}
                    className="h-7 font-mono text-xs"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
                <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                  new
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Don't add ${key}`}
                  onClick={() => unstage(key)}
                >
                  <Undo2Icon />
                  Undo
                </Button>
              </div>
              {errors[key] ? <p className="text-destructive text-xs">{errors[key]}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form onSubmit={add} noValidate className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Input
              aria-label="New variable's key"
              placeholder="KEY"
              value={newKey}
              onChange={(event) => {
                setNewKey(event.target.value);
                setAddError(null);
              }}
              aria-invalid={addError ? true : undefined}
              className="h-8 w-56 font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
            <Input
              aria-label="New variable's value"
              placeholder="value"
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              className="h-8 flex-1 font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
            <Button type="submit" variant="outline" size="sm">
              <PlusIcon aria-hidden="true" />
              Add
            </Button>
          </div>
          {addError ? (
            <p role="alert" className="text-destructive text-xs">
              {addError}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
