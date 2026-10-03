// Regenerates *.module.css.d.ts from the class selectors in each module.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".module.css")) out.push(p);
  }
  return out;
}
for (const file of walk(process.argv[2] ?? "src")) {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/:global\([^)]*\)/g, "").replace(/url\([^)]*\)/g, "");
  const names = [...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]))].filter((n) => !/^\d/.test(n)).sort();
  const body = names.map((n) => `  readonly ${JSON.stringify(n).replace(/^"(\w+)"$/, "$1")}: string;`).join("\n");
  writeFileSync(`${file}.d.ts`, `declare const styles: {\n${body}\n};\nexport default styles;\n`);
  console.log(file, names.length);
}
