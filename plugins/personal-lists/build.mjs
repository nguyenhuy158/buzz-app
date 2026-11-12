import { build } from "vite";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const endpoint = process.env.BUZZ_PERSONAL_LISTS_URL;
if (!endpoint || new URL(endpoint).protocol !== "https:")
  throw new Error("Set BUZZ_PERSONAL_LISTS_URL to the HTTPS sync Worker.");
await build({
  configFile: false,
  root,
  define: { PERSONAL_SYNC_URL: JSON.stringify(new URL(endpoint).origin) },
  esbuild: {
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
  },
  build: {
    outDir: "../../dist-plugins/personal-lists",
    emptyOutDir: true,
    lib: {
      entry: `${root}index.tsx`,
      formats: ["es"],
      fileName: () => "plugin.js",
    },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
await mkdir(`${root}../../dist-plugins/personal-lists`, { recursive: true });
await writeFile(
  `${root}../../dist-plugins/personal-lists/manifest.json`,
  `${JSON.stringify(
    {
      id: "personal.lists",
      name: "Personal Lists",
      apiVersion: 1,
      host: {
        networkOrigins: [new URL(endpoint).origin],
        commands: [
          {
            id: "reminders",
            program: "buzz-personal-reminders",
            args: ["sync"],
            maxInputBytes: 65536,
          },
        ],
      },
    },
    null,
    2,
  )}\n`,
);
await copyFile(
  `${root}README.md`,
  `${root}../../dist-plugins/personal-lists/README.md`,
);
