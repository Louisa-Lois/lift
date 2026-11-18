import { z } from "zod";
import { UserId } from "../ids";
import { GithubLogin, Timestamp } from "./common";

/** `GET /me`. A Lift account, made from the GitHub profile on first sign-in. */
export const User = z.object({
  id: UserId,
  githubId: z.number().int().positive(),
  login: GithubLogin,
  name: z.string().nullable(),
  email: z.email().nullable(),
  avatarUrl: z.url(),
  createdAt: Timestamp,
});
export type User = z.infer<typeof User>;

/** What other people see of a user: members, commit authors, presence. */
export const UserSummary = User.pick({ id: true, login: true, name: true, avatarUrl: true });
export type UserSummary = z.infer<typeof UserSummary>;
