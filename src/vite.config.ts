import { defineConfig } from "vite";
import webExtension, { readJsonFile } from "vite-plugin-web-extension";
import * as process from "process";

const target = process.env.TARGET || "chrome";

function generateManifest() {
    const manifest = readJsonFile("manifest.json");
    const pkg = readJsonFile("package.json");
    return {
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        ...manifest,
    };
}

export default defineConfig({
    plugins: [
        webExtension({
            manifest: generateManifest,
            watchFilePaths: ["package.json", "manifest.json"],
            browser: target
        }),
    ],
    define: {
        __BROWSER__: JSON.stringify(target),
    }
});
