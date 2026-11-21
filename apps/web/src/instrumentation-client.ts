// Runs in the browser before the app's own code (Next.js's instrumentation-client file).
//
// When the first schema is created, Zod checks whether `new Function` works, and if it does it
// compiles its parsers with it. The Content-Security-Policy (src/lib/csp.ts) allows no eval, so
// the check would be reported as a violation, and fail once the policy is enforced. Without it,
// Zod parses the same, a little slower. It has to be set before @lift/shared creates its schemas.
import { z } from "zod";

z.config({ jitless: true });
