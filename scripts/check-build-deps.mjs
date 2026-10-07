/**
 * The packages `npm run build` needs, checked before it gets to need them.
 *
 * `npm install` skips devDependencies whenever `NODE_ENV=production` — npm's own
 * `production` config defaults to it — so a host that builds this app with the
 * app's environment variables in place hands `npm run build` a tree with no
 * Prisma CLI, no TypeScript, no Tailwind and no tsx. (Hostinger Business does
 * exactly this; `NODE_ENV=production` is in its panel because the deployment
 * guide says to put it there.) The build then dies on whichever one it reaches
 * first, naming the tool and nothing else:
 *
 *   > npm run build
 *   > prebuild
 *   > npm run vendor:swagger
 *   sh: line 1: tsx: command not found
 *
 * Which reads like a typo in this repository rather than a dependency the
 * platform declined to install, and sends you looking in the script. It cost one
 * Hostinger deploy to find that out, so this runs first and says the true thing.
 *
 * Plain Node, and `.mjs` rather than the `.ts` the rest of `scripts/` uses,
 * because tsx is one of the packages it exists to notice the absence of: it has
 * to run in the tree where nothing else is installed. Nothing here is a runtime
 * import — none of these packages ships in the standalone server, and the
 * Dockerfile installs them for the builder stage the same way the host must.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Every entry here is reached by `npm run build`, and here is where. */
const NEEDED = [
  ["tsx", "runs scripts/vendor-swagger.ts, which `prebuild` calls"],
  ["swagger-ui-dist", "the console assets that script copies into public/docs/"],
  ["prisma", "`prisma generate`, the first half of `build`"],
  ["typescript", "`next build` type-checks the app with it"],
  ["@types/node", "the Node types it checks process and node: imports against"],
  ["@types/react", "the React types every component is checked against"],
  ["@types/react-dom", "the React DOM types the eight useFormStatus forms need"],
  ["@types/three", "the three.js types components/model-viewer.tsx imports"],
  ["tailwindcss", "the stylesheet Next compiles"],
  ["@tailwindcss/postcss", "the PostCSS plugin postcss.config.mjs names"],
];

const root = process.cwd();
const missing = NEEDED.filter(([name]) => !existsSync(join(root, "node_modules", name)));

if (missing.length === 0) process.exit(0);

// A skipped devDependency and a tree that was never installed look identical
// from here, and the command that fixes them is the same, so say both.
const installed = existsSync(join(root, "node_modules"));

console.error(
  `The build's own dependencies are missing from node_modules/ ` +
    `(${missing.length} of ${NEEDED.length}):\n\n` +
    missing.map(([name, why]) => `  ${name.padEnd(22)} ${why}`).join("\n") +
    "\n\n" +
    (installed
      ? "This is what a production install looks like. `npm install` skips\n" +
        "devDependencies when NODE_ENV=production, so a host that builds the app with\n" +
        "its environment in place installs roughly half the tree and then cannot build\n" +
        "with it.\n"
      : "node_modules/ is missing or empty: nothing has been installed here yet.\n") +
    "\nInstall them and build again:\n\n" +
    "  npm install --include=dev\n" +
    "  npm run build\n\n" +
    "A host that runs the install for you cannot be passed that flag, so set\n" +
    "NPM_CONFIG_INCLUDE=dev in its environment instead — docs/hostinger-deployment.md\n" +
    "is where that is written down for the deployment that found this.\n",
);
process.exit(1);
