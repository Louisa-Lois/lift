import type { ReactNode } from "react";

/** What the API's redirect to /login?error=… means, in words. */
function messageFor(error: string, login: string | null): { title: string; body: ReactNode } {
  switch (error) {
    case "invite_only":
      return {
        title: "Lift is invite-only for now",
        body: (
          <>
            {login ? (
              <>
                Your GitHub account <span className="font-medium text-foreground">@{login}</span>{" "}
                isn't on the list yet.
              </>
            ) : (
              "Your GitHub account isn't on the list yet."
            )}{" "}
            Ask the Lift team to add you. Signed in to GitHub with another account? Sign out of
            GitHub first, then continue again.
          </>
        ),
      };
    case "denied":
      return {
        title: "Sign-in cancelled",
        body: "You cancelled the sign-in on GitHub. Continue whenever you're ready.",
      };
    case "state":
      return {
        title: "That sign-in expired",
        body: "It took more than 10 minutes or started in another tab. Try again.",
      };
    case "github":
      return { title: "GitHub didn't answer", body: "Try again in a moment." };
    case "config":
      return {
        title: "Sign-in isn't set up here",
        body: "This server has no GitHub OAuth app configured yet.",
      };
    default:
      return { title: "Sign-in didn't work", body: "Try again." };
  }
}

/** The message on /login after a sign-in didn't finish. */
export function LoginMessage({ error, login }: { error: string; login: string | null }) {
  const message = messageFor(error, login);
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <p className="font-heading font-medium text-card-foreground">{message.title}</p>
      <p className="text-muted-foreground">{message.body}</p>
    </div>
  );
}
