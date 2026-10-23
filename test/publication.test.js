import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { buildSite, output, siteFiles } from "../scripts/build.mjs";
import { basePath, createPreviewServer } from "../scripts/preview.mjs";

const server = createPreviewServer();
let base;
before(async () => {
  await buildSite();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test("publication contains exactly the approved V2 assets and removes stale output", async () => {
  await writeFile(new URL("stale-private-file.txt", output), "Must not be published");
  await buildSite();
  const paths = [];
  async function walk(directory, prefix = "") {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isDirectory()) await walk(new URL(`${item.name}/`, directory), `${prefix}${item.name}/`);
      else paths.push(`${prefix}${item.name}`);
    }
  }
  await walk(output);
  assert.deepEqual(paths.sort(), [...siteFiles, ".nojekyll"].sort());
  for (const file of siteFiles) {
    assert.ok((await stat(new URL(file, output))).size > 0, file);
    const contents = await readFile(new URL(file, output), "utf8");
    assert.doesNotMatch(contents, /Classic|classic-link|BEGIN [A-Z ]*PRIVATE KEY|github_pat_|\b10(?:\.\d{1,3}){3}\b|\b192\.168(?:\.\d{1,3}){2}\b|\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b/i, file);
    assert.doesNotMatch(contents, /https?:\/\//, file);
    if (file.endsWith(".js")) {
      for (const match of contents.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        const target = new URL(match[1], new URL(file, output));
        assert.ok(target.href.startsWith(output.href));
        assert.ok((await stat(target)).isFile(), `${file}: ${match[1]}`);
      }
    }
  }
});

test("the site loads beneath a repository prefix and serves the actual solver worker", async () => {
  assert.equal(server.address().address, "127.0.0.1");
  const root = await fetch(base, { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), basePath);
  for (const file of siteFiles) {
    const response = await fetch(base + basePath + file);
    assert.equal(response.status, 200, file);
    assert.ok((await response.text()).length);
  }
  const html = await (await fetch(base + basePath + "?route=5")).text();
  assert.match(html, /\.\/src\/app\.js/);
  assert.match(html, /worker-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /classic|https?:\/\//i);
});

test("preview never serves tooling, repository metadata, private files or traversal paths", async () => {
  for (const path of ["server.js", "package.json", "README.md", ".env", ".git/config", "scripts/build.mjs", ".github/workflows/pages.yml", "../package.json", "%2e%2e%5cpackage.json", "src%5cengine.js"]) {
    assert.equal((await fetch(base + basePath + path)).status, 404, path);
  }
  assert.equal((await fetch(base + basePath, { method: "POST" })).status, 405);
  assert.equal((await fetch(base + basePath + "%broken")).status, 400);
  const head = await fetch(base + basePath, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("x-content-type-options"), "nosniff");
  assert.equal(head.headers.get("x-frame-options"), "DENY");
});
