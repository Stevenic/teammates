// Patches @github/copilot-sdk to fix ESM subpath import for vscode-jsonrpc.
// The SDK imports "vscode-jsonrpc/node" but vscode-jsonrpc@8.x has no exports
// map, so Node's ESM resolver fails. This adds the ".js" extension.
// Remove this patch once copilot-sdk ships a fix upstream.

const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "@github",
  "copilot-sdk",
  "dist",
  "session.js"
);

if (!fs.existsSync(target)) {
  // copilot-sdk not installed yet (e.g. during workspace linking) — skip
  process.exit(0);
}

let src = fs.readFileSync(target, "utf8");

if (src.includes('vscode-jsonrpc/node"') && !src.includes('vscode-jsonrpc/node.js"')) {
  src = src.replace(/vscode-jsonrpc\/node"/g, 'vscode-jsonrpc/node.js"');
  fs.writeFileSync(target, src, "utf8");
  console.log("Patched @github/copilot-sdk: vscode-jsonrpc/node -> vscode-jsonrpc/node.js");
}
