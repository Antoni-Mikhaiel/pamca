import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads `.env` into `process.env` as an import side effect. dev-server.ts imports
 * this FIRST, before the shared router (which transitively initialises
 * src/lib/supabase.ts — that module throws if SUPABASE_* are unset). ES module
 * imports are evaluated before any top-level statements, so the env must be
 * loaded from an earlier-imported module rather than a later function call.
 *
 * On Vercel this file is unused; the platform injects env vars into process.env.
 */
function loadDotEnvFile(filePath: string): void {
  let text = "";

  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      // Strip an unquoted inline comment (whitespace + "#" to end of line), matching
      // dotenv. Quoted values keep any "#" verbatim.
      const commentIndex = value.search(/\s#/);
      if (commentIndex >= 0) value = value.slice(0, commentIndex).trim();
    }

    process.env[key] = value;
  }
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnvFile(path.join(rootDir, ".env"));
