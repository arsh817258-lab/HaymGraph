const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const bundleDir = path.join(distDir, 'HaymGraph');

// Clean dist folder
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(bundleDir, { recursive: true });

const manifestFiles = [
    '.debug',
    'index.html',
    'package.json',
    'README.md',
    'install.bat',
    'install.sh',
    'css/style.css',
    'CSXS/manifest.xml',
    'js/app.js',
    'js/coreMath.js',
    'js/csInterface.js',
    'js/curveBox.js',
    'js/update.js',
    'jsx/host.jsx',
    'jsx/json2.js'
];

console.log('Copying necessary extension files...');
for (const relPath of manifestFiles) {
    const src = path.join(rootDir, relPath);
    const dest = path.join(bundleDir, relPath);
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    console.log('  + ' + relPath);
}

const zipName = 'HaymGraph-v1.0.1.zip';
const zipPath = path.join(rootDir, zipName);
const aliasZipPath = path.join(rootDir, 'HaymGraph.zip');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
if (fs.existsSync(aliasZipPath)) fs.unlinkSync(aliasZipPath);

console.log('Compressing archive...');
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${distDir}\\HaymGraph' -DestinationPath '${zipPath}' -Force"`);
fs.copyFileSync(zipPath, aliasZipPath);

// Clean temporary dist directory
fs.rmSync(distDir, { recursive: true, force: true });

const stats = fs.statSync(zipPath);
console.log(`\nSuccessfully created distribution package:`);
console.log(`  File: ${zipPath}`);
console.log(`  Size: ${(stats.size / 1024).toFixed(1)} KB`);
console.log(`  Alias: ${aliasZipPath}`);
