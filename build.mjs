// Copies the game client into public/, which the server serves. The build id lets
// open browser tabs notice a new deploy and reload themselves.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { bakeAll } from './art/bake.mjs';

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const out = f => new URL(`public/${f}`, import.meta.url);
const files = ['engine.js', 'sprites.js', 'art.js', 'wallet.js', 'ui.js'];
const template = read('src/template.html');

mkdirSync(new URL('public/', import.meta.url), { recursive: true });
const atlas = await bakeAll(new URL('public/atlas/', import.meta.url));
const build = createHash('sha256').update(template + files.map(f => read(`src/${f}`)).join('') + atlas.hash).digest('hex').slice(0, 16);
for (const f of files) writeFileSync(out(f), read(`src/${f}`));
writeFileSync(out('index.html'), template.replace('__BUILD__', build));
writeFileSync(out('build.json'), JSON.stringify({ build }));
console.log(`Built public/ (build ${build}, sprites ${atlas.cached ? 'cached' : 'baked'})`);
