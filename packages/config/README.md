# @lift/config

Shared TypeScript presets. **Owner:** WS5 CLI, quality & delivery.

| Preset | Used by |
| --- | --- |
| `tsconfig/node.json` | Node.js apps and `packages/db` |
| `tsconfig/next.json` | `apps/web` |
| `tsconfig/library.json` | `packages/shared`, which runs in Node.js and the browser |

All three extend the strict settings in the root `tsconfig.base.json`. Extend them by relative path, for example `"extends": "../../packages/config/tsconfig/node.json"`, because Vite does not follow pnpm's symlinks when it reads `extends`.
