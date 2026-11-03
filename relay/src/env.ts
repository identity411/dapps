import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadEnvFile } from "dotenv";

// npm workspaces run scripts with the workspace directory as cwd, so the
// default dotenv lookup would miss the repository-root .env. Resolve it from
// this source file instead, from both `npm run relay` and direct workspace runs.
const projectEnvPath = fileURLToPath(new URL("../../.env", import.meta.url));

if (existsSync(projectEnvPath)) {
  loadEnvFile({ path: projectEnvPath });
}
