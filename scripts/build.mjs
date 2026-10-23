import { copyFile, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const siteFiles = Object.freeze([
  "index.html",
  "style.css",
  "game.css",
  "src/app.js",
  "src/engine.js",
  "src/holds.js",
  "src/motion.js",
  "src/rig.js",
  "src/routes.js",
  "src/rules.js",
  "src/search.js",
  "src/solver.js",
  "src/solver-worker.js",
]);

export const output = new URL("../dist/", import.meta.url);

export async function buildSite() {
  const source = new URL("../public/", import.meta.url);
  for (const file of siteFiles) {
    const details = await lstat(new URL(file, source));
    if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Expected a regular site asset: ${file}`);
  }
  // Recreate only this project's fixed build directory so stale files cannot be published.
  await rm(output, { recursive: true, force: true });
  for (const file of siteFiles) {
    const destination = new URL(file, output);
    await mkdir(dirname(fileURLToPath(destination)), { recursive: true });
    await copyFile(new URL(file, source), destination);
  }
  await writeFile(new URL(".nojekyll", output), "");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await buildSite();
  console.log(`Built ${siteFiles.length} browser assets in dist.`);
}
