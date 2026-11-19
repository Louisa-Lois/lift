import { GithubLogin, GithubRepoName } from "@lift/shared";

/**
 * A repo pasted into the picker: `https://github.com/owner/repo`, the same with `.git` or a path
 * after it, an SSH clone URL, or plain `owner/repo`. Null for anything else, including a bare
 * search word.
 */
export function parseGithubRepo(input: string): { owner: string; name: string } | null {
  const text = input.trim();
  const match =
    text.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i) ??
    text.match(/^git@github\.com:([^/\s]+)\/([^/\s]+)$/i) ??
    text.match(/^([^/\s:]+)\/([^/\s]+)$/);
  if (!match) return null;
  const owner = match[1] ?? "";
  const name = (match[2] ?? "").replace(/\.git$/i, "");
  return GithubLogin.safeParse(owner).success && GithubRepoName.safeParse(name).success
    ? { owner, name }
    : null;
}
