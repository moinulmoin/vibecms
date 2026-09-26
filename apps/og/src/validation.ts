import type { OgCardModel, OgFontFamily } from "@vc/content/og-card";

const fonts = new Set<OgFontFamily>(["Geist", "Geist Mono", "Newsreader", "Space Grotesk", "Hanken Grotesk"]);
const color = /^#[0-9a-fA-F]{6}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid OG model");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).some((key) => !expected.includes(key)) || expected.some((key) => !(key in value))) {
    throw new TypeError("Invalid OG model fields");
  }
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function optionalText(value: unknown, max: number): boolean {
  return value === null || bounded(value, max);
}
function integer(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

export function validateOgCardModel(input: unknown): OgCardModel {
  const model = record(input);
  keys(model, ["kind", "mode", "colors", "fonts", "headingWeight", "radius", "siteName", "host", "title", "titleSize", "description", "descriptionLines", "meta"]);
  const colors = record(model.colors);
  keys(colors, ["bg", "fg", "muted", "hairline", "accent"]);
  const fontPair = record(model.fonts);
  keys(fontPair, ["heading", "body"]);
  if (!(["post", "home"].includes(model.kind as string) && ["light", "dark"].includes(model.mode as string)) ||
      !Object.values(colors).every((value) => typeof value === "string" && color.test(value)) ||
      !Object.values(fontPair).every((value) => fonts.has(value as OgFontFamily)) ||
      !integer(model.headingWeight, 100, 900) || !integer(model.radius, 0, 32) ||
      !bounded(model.siteName, 60) || !bounded(model.host, 253) || !bounded(model.title, 160) ||
      !optionalText(model.description, 220) || !optionalText(model.meta, 220) ||
      !integer(model.titleSize, 32, 100) || !integer(model.descriptionLines, 1, 2)) {
    throw new TypeError("Invalid OG model values");
  }
  return input as OgCardModel;
}
