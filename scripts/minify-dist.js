// Uses esbuild's JS API directly (no shell spawn, no `npx` PATH dependency)
// esbuild is listed in devDependencies and is always available after `pnpm install`.
const esbuild = require('esbuild');
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

async function main() {
  const jsFiles = getFiles('dist');
  console.log(`Minifying ${jsFiles.length} JavaScript files in dist/...`);

  await Promise.all(
    jsFiles.map(async f => {
      const original = fs.readFileSync(f, 'utf8');
      const hasShebang = original.startsWith('#!');

      // Strip shebang before esbuild (esbuild can't parse it)
      const source = hasShebang ? original.slice(original.indexOf('\n') + 1) : original;

      const result = await esbuild.transform(source, {
        minify: true,
        // Keep module format as-is (CJS or ESM)
        format: f.includes(`${path.sep}esm${path.sep}`) ? 'esm' : 'cjs',
      });

      let output = result.code;
      if (hasShebang) {
        output = `#!/usr/bin/env node\n${output}`;
      }
      fs.writeFileSync(f, output, 'utf8');

      if (hasShebang) {
        try {
          fs.chmodSync(f, 0o755);
        } catch {}
      }
    }),
  );

  if (fs.existsSync('dist/esm')) {
    fs.writeFileSync('dist/esm/package.json', JSON.stringify({ type: 'module' }, null, 2), 'utf8');
  }

  console.log('Minification complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
