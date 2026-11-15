// Copy just the files a web server needs into dist/: node tools/build.mjs
// There is no bundling step; the app is plain HTML, CSS and ES modules.
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const item of ['index.html', 'css', 'js', 'assets']) await cp(`${root}${item}`, `${dist}/${item}`, { recursive: true });
console.log(`Ready to upload: ${dist}`);
