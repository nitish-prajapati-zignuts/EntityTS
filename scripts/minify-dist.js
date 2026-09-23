const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(file));
    } else if (file.endsWith('.js') || file.endsWith('.mjs')) {
      results.push(file);
    }
  });
  return results;
}

const jsFiles = getFiles('dist');
console.log(`Minifying ${jsFiles.length} JavaScript files in dist/...`);
for (const f of jsFiles) {
  const original = fs.readFileSync(f, 'utf8');
  const hasShebang = original.startsWith('#!');
  execSync(`npx esbuild "${f}" --minify --allow-overwrite --outfile="${f}"`);
  if (hasShebang) {
    const minContent = fs.readFileSync(f, 'utf8');
    if (!minContent.startsWith('#!')) {
      fs.writeFileSync(f, `#!/usr/bin/env node\n${minContent}`, 'utf8');
    }
    try {
      fs.chmodSync(f, 0o755);
    } catch {}
  }
}
if (fs.existsSync('dist/esm')) {
  fs.writeFileSync('dist/esm/package.json', JSON.stringify({ type: 'module' }, null, 2), 'utf8');
}
console.log('Minification complete.');
