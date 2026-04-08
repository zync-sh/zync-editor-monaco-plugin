import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const templatePath = path.join(root, 'src', 'editor-shell.html');
const jsPath = path.join(root, 'dist', 'editor.js');
const distPath = path.join(root, 'dist');
const cssPath = path.join(root, 'dist', 'editor.css');
const outputPath = path.join(root, 'editor.html');

const [template, js] = await Promise.all([
  readFile(templatePath, 'utf8'),
  readFile(jsPath, 'utf8'),
]);

let css = '';
try {
  css = await readFile(cssPath, 'utf8');
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
    const files = await readdir(distPath);
    const emittedCss = files.find((name) => name.endsWith('.css'));
    if (emittedCss) {
      css = await readFile(path.join(distPath, emittedCss), 'utf8');
    } else {
      css = '';
    }
  } else {
    throw error;
  }
}

const encodedJs = Buffer.from(js, 'utf8').toString('base64');
const encodedCss = Buffer.from(css, 'utf8').toString('base64');

const html = template
  .replace(
    '<!-- __BOOTSTRAP__ -->',
    `<script>
(() => {
  const bootLoading = document.getElementById('boot-loading');
  const markBootFailed = (message) => {
    if (!bootLoading) return;
    bootLoading.setAttribute('aria-busy', 'false');
    bootLoading.textContent = message;
  };
  const BOOT_TIMEOUT_MS = 10000;
  const timeout = setTimeout(() => {
    const isBusy = bootLoading?.getAttribute('aria-busy') === 'true';
    if (isBusy) {
      markBootFailed('Monaco editor is taking longer than expected. Try reopening the file.');
    }
  }, BOOT_TIMEOUT_MS);

  const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const css = decode('${encodedCss}');
  if (css) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }
  try {
    const script = document.createElement('script');
    script.textContent = decode('${encodedJs}');
    document.body.appendChild(script);
  } catch (error) {
    markBootFailed('Failed to initialize Monaco editor. Please reinstall plugin or contact support.');
    throw error;
  } finally {
    if (bootLoading?.getAttribute('aria-busy') !== 'true') {
      clearTimeout(timeout);
    }
  }
})();
</script>`
  );

await writeFile(outputPath, html, 'utf8');
