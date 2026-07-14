// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Let Metro see + hot-reload changes made in shared workspace packages
// (@datasheets/core, and any others pulled in later) instead of only apps/mobile.
config.watchFolders = [workspaceRoot];

// Resolve modules from this app's node_modules first, then fall back to the
// hoisted root node_modules that pnpm's workspace links populate.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// pnpm uses symlinks for workspace packages (@datasheets/core, etc.) — Metro
// needs to follow those rather than treating them as external node_modules.
// NOTE: hierarchical lookup must stay enabled — pnpm gives every package its
// own nested node_modules (via .pnpm/<key>/node_modules/<pkg>), and disabling
// hierarchical lookup breaks resolution of *their* transitive deps (e.g.
// `expo` -> `expo-modules-core`), not just this app's own imports.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
