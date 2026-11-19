import { OnboardingPlan } from "../schemas/plan";
import { fixtureHex, fixtureId } from "./ids";

/**
 * The assistant's plan for lift-demo/express-postgres: one web service, a Postgres database, and a
 * variable of every source, including a required one the user must fill.
 */
export const onboardingPlan = OnboardingPlan.parse({
  id: fixtureId("pln", "express-postgres"),
  repo: {
    owner: "lift-demo",
    name: "express-postgres",
    branch: "main",
    commitSha: fixtureHex("commit:express-postgres", 40),
  },
  summary:
    "An Express API that keeps notes in Postgres. Lift runs it as one web service on port 3000, with a Postgres database.",
  framework: "express",
  services: [
    {
      name: "api",
      rootDir: ".",
      type: "web",
      builder: "railpack",
      buildCommand: null,
      startCommand: "node server.js",
      port: 3000,
      healthcheckPath: "/health",
      rationale: "server.js listens on process.env.PORT and answers /health.",
    },
  ],
  databases: [
    {
      type: "postgres",
      name: "notes-db",
      envVar: "DATABASE_URL",
      rationale: "server.js connects with pg through DATABASE_URL.",
    },
  ],
  variables: [
    {
      service: "api",
      key: "DATABASE_URL",
      source: "database",
      required: true,
      description: "Lift's Postgres, filled in once it's ready.",
    },
    {
      service: "api",
      key: "SESSION_SECRET",
      source: "generated",
      required: true,
      description: "Signs the session cookie. Lift fills in a random value.",
    },
    {
      service: "api",
      key: "NODE_ENV",
      source: "default",
      value: "production",
      required: false,
      description: "Runs Express in production mode.",
    },
    {
      service: "api",
      key: "STRIPE_SECRET_KEY",
      source: "user",
      required: true,
      description: "Your Stripe secret key, from the Stripe dashboard.",
    },
    {
      service: "api",
      key: "SENTRY_DSN",
      source: "user",
      required: false,
      description: "Sends errors to Sentry, if you use it.",
    },
  ],
  warnings: [
    "The README mentions Redis for caching. Lift doesn't run Redis yet, so it was left out.",
  ],
  confidence: "high",
});
