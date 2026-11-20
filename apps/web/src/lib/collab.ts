/**
 * The live editor's collab server. Production builds get wss://app.{domain}/collab as a build
 * argument (NEXT_PUBLIC_COLLAB_URL, inlined at build time); development connects to port 4200.
 */
export const COLLAB_URL = process.env.NEXT_PUBLIC_COLLAB_URL || "ws://localhost:4200";
