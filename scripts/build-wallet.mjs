/**
 * Empaqueta la wallet del comprador para el navegador.
 * Uso: node scripts/build-wallet.mjs
 */
import { build } from "esbuild";
import { copyFileSync } from "fs";

await build({
  entryPoints: ["web/wallet-entry.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: "web/wallet.bundle.js",
  logLevel: "info",
});

copyFileSync("web/wallet.bundle.js", "docs/wallet.bundle.js");
console.log("wallet.bundle.js listo");
