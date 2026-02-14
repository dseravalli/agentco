import solidPlugin from "@opentui/solid/bun-plugin"

await Bun.build({
  entrypoints: ["./src/index.tsx"],
  target: "bun",
  outdir: "./dist",
  plugins: [solidPlugin],
})

console.log("Build complete: dist/index.js")
