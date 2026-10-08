// Build-time check that the tree has every devDependency installed.
//
// The build needs devDependencies — tsx, the Prisma CLI, TypeScript and the
// @types packages, Tailwind, swagger-ui-dist — every one of them needed to
// *build* the app and none of them to *run* it. A host that installs
// production deps only (NODE_ENV=production, or npm's own `production`
// config) therefore produces a tree where the build dies on the first
// missing tool with an error that reads like a typo rather than a missing
// half of the install.
//
// This script runs first in `prebuild` and names exactly what is missing
// plus the two ways to install it; docs/hostinger-deployment.md has the
// full story. It checks package presence directly on disk — no `require`
// (this is an ESM file; `require` does not exist here and an earlier
// version's swallowed ReferenceError reported every package as missing
// even when it was installed) — just
// `node_modules/<name>/package.json`, which is what npm lays down.
//
// Exit code 1 when anything is missing, so the build stops here with this
// message instead of failing later somewhere less helpful.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Why the *build* reaches for a devDependency. Falls back to a generic line. */
const WHY = {
  tsx: "vendor:swagger and every `tsx <script>` run",
  prisma: "prisma generate (first command of the `build` script)",
  typescript: "next build's type checking",
  tailwindcss: "the PostCSS/Tailwind step of next build",
  "@tailwindcss/postcss": "postcss.config.mjs loads it during next build",
  "swagger-ui-dist": "vendor:swagger copies it into public/docs/ before build",
  "@types/node": "type checking: Buffer, process and every node: import",
  "@types/react": "type checking: JSX",
  "@types/react-dom": "type checking: react-dom",
  "@types/nodemailer": "type checking: the mailer",
  "@types/three": "type checking: the model viewer",
  "@aws-sdk/client-s3": "type checking: scripts/export-storage.ts",
  "puppeteer-core": "type checking: scripts/screenshot.ts",
};

function installed(name) {
  // Works for scoped packages too: split("/") yields ["@types", "node"].
  return existsSync(
    join(projectRoot, "node_modules", ...name.split("/"), "package.json"),
  );
}

function main() {
  const pkg = JSON.parse(
    readFileSync(join(projectRoot, "package.json"), "utf8"),
  );
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  const missing = devDeps.filter((name) => !installed(name));

  if (missing.length === 0) {
    console.info("build-deps guard: all devDependencies present");
    return;
  }

  console.error(
    "build-deps guard: the tree is missing devDependencies the build needs:\n",
  );
  for (const name of missing) {
    console.error(
      `  - ${name}\n      needed by: ${WHY[name] ?? "the build (devDependency)"}`,
    );
  }
  console.error(
    "\nThese are devDependencies: npm skipped them because the install ran\n" +
      "as production-only (NODE_ENV=production or npm's `production` config).\n" +
      "Two fixes, both on the install — never on the app:\n" +
      "\n" +
      "  1. Set this in the build environment, then redeploy:\n" +
      "       NPM_CONFIG_INCLUDE=dev\n" +
      "  2. If the panel ignores environment variables, prefix the build command:\n" +
      "       npm install --include=dev && npm run build\n" +
      "\n" +
      "Full story: docs/hostinger-deployment.md\n",
  );
  process.exitCode = 1;
}

main();
