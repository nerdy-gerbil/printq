// Build-time check that the build's dev dependencies are present before
// anything that would say "tsx: command not found" and read like a typo in the
// package.json rather than a missing half of the tree.

// This file is ESM by extension (.mjs) and runs under Node directly — no
// framework, no package manager wrapper, and no dependency on anything that is
// not already in the tree the build is about to attempt.

const REQUIRED_DEV_TOOLS = {
  tsx: {
    // scripts/vendor-swagger.ts, scripts/*.ts migration one-shots, any other
    // direct `tsx <script>` on the command line.
    why: "vendor:swagger and direct .ts script runs",
    resolvedBy: "NPM_CONFIG_INCLUDE=dev, or the --include=dev flag on npm install",
  },
  prisma: {
    why: "prisma migrate deploy / prisma generate (built via npx from the CLI in node_modules)",
    resolvedBy:
      "NPM_CONFIG_INCLUDE=dev — prisma is a devDependency in this project",
  },
  "typescript": {
    why: "next build's type checking and the @types packages need the compiler present",
    resolvedBy: "NPM_CONFIG_INCLUDE=dev",
  },
  "tailwindcss": {
    why: "postcss/tailwind step in the build",
    resolvedBy: "NPM_CONFIG_INCLUDE=dev",
  },
};

function binPathFor(name) {
  try {
    // node_modules/.bin/<name> is where npm puts the command the build will run.
    return require.resolve(`${name}/package.json`, {
      paths: [process.cwd()],
    })
      .replace(/[/\\]package\.json$/, `/node_modules/.bin/${name}`)
      .replace(/\\/g, "/");
  } catch {
    return undefined;
  }
}

function missing() {
  const out = [];
  for (const name of Object.keys(REQUIRED_DEV_TOOLS)) {
    if (!binPathFor(name)) out.push(name);
  }
  return out;
}

function main() {
  const missingTools = missing();
  if (missingTools.length === 0) {
    console.info("build-deps guard: all required dev tools present");
    return;
  }

  console.error(
    "build-deps guard: the tree is missing tools the build reaches for:\n",
  );
  for (const name of missingTools) {
    const info = REQUIRED_DEV_TOOLS[name];
    console.error(
      `  - ${name}\n` +
        `      needed by: ${info.why}\n` +
        `      install:  ${info.resolvedBy}`,
    );
  }
  console.error(
    "\nThe variable that fixes this on a host that installs production deps only:\n" +
      "  NPM_CONFIG_INCLUDE=dev\n" +
      "Put it in the build environment (not the app runtime), then redeploy.\n" +
      "If the panel ignores environment variables, make the build command:\n" +
      "  npm install --include=dev && npm run build\n",
  );
  process.exitCode = 1;
}

main();
