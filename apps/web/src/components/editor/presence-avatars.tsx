import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import type { Person } from "@/lib/editor-files";

const SHOWN = 5;

/** Only GitHub's avatars load: these URLs come from other people's browsers. */
const safeAvatar = (url: string) => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" &&
      (hostname === "github.com" || hostname.endsWith(".githubusercontent.com"))
      ? url
      : undefined;
  } catch {
    return undefined;
  }
};

/** Who has the file open (FE-13): up to five faces, each ringed in their cursor's colour, then "+N". */
export function PresenceAvatars({ people }: { people: Person[] }) {
  if (people.length === 0) return null;
  const names = people.map(({ user, self }) => (self ? `${user.name} (you)` : user.name));
  return (
    <AvatarGroup aria-label={`In this file: ${names.join(", ")}`} role="img">
      {people.slice(0, SHOWN).map(({ user, self }) => (
        <Avatar
          key={user.id}
          size="sm"
          title={self ? `${user.name} (you)` : user.name}
          className="ring-2"
          style={{ ["--tw-ring-color" as string]: user.color }}
        >
          <AvatarImage src={safeAvatar(user.avatarUrl)} alt="" />
          <AvatarFallback>{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ))}
      {people.length > SHOWN ? (
        <AvatarGroupCount className="size-6 text-xs">+{people.length - SHOWN}</AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  );
}
