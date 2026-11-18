import { createRequire } from "node:module";

// package.json sits one level above both src/ and the built dist/.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export const clientInfo = {
  name: "codex_limit_auto_reset",
  title: "Codex Limit Auto Reset",
  version,
};
