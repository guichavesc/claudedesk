#!/usr/bin/env node
/**
 * In unpackaged `npm run dev`, macOS Dock shows the host bundle name from
 * node_modules/electron/dist/Electron.app — which is "Electron". Patch the
 * Info.plist (+ dock icon) so hover/title say ClaudeDesk during development.
 * Packaged builds already use productName via electron-builder.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const appRoot = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const plistPath = path.join(appRoot, 'Contents', 'Info.plist');
const resourcesDir = path.join(appRoot, 'Contents', 'Resources');

if (!fs.existsSync(plistPath)) {
  console.warn('[patch-electron] Electron.app not found — skip (run npm install first)');
  process.exit(0);
}

let plist = fs.readFileSync(plistPath, 'utf8');
const replacements = [
  [/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleDisplayName</key>\n\t<string>ClaudeDesk</string>'],
  [/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleName</key>\n\t<string>ClaudeDesk</string>'],
  [/<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleIdentifier</key>\n\t<string>com.claudedesk.app.dev</string>'],
];

let changed = false;
for (const [re, value] of replacements) {
  const next = plist.replace(re, value);
  if (next !== plist) {
    plist = next;
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(plistPath, plist);
  console.log('[patch-electron] Info.plist → ClaudeDesk');
} else {
  console.log('[patch-electron] Info.plist already ClaudeDesk');
}

// Prefer our transparent icon in the Electron.app Resources slot macOS reads.
const iconSrc = path.join(root, 'build', 'icon.icns');
const iconDest = path.join(resourcesDir, 'electron.icns');
if (fs.existsSync(iconSrc) && fs.existsSync(resourcesDir)) {
  fs.copyFileSync(iconSrc, iconDest);
  console.log('[patch-electron] Copied build/icon.icns → Electron.app Resources');
}
