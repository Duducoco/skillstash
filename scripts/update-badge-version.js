import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

for (const file of ['README.md', 'README_zh.md']) {
  const path = join(root, file);
  const updated = readFileSync(path, 'utf8').replace(
    /badge\.socket\.dev\/npm\/package\/skillstash\/[\d.]+/g,
    `badge.socket.dev/npm/package/skillstash/${version}`
  );
  writeFileSync(path, updated);
}
