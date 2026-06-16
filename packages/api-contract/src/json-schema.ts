import type { z } from "zod";

type JsonSchema = Record<string, unknown>;

/**
 * Minimal zod → JSON Schema for MCP outputSchema (Zod 4).
 * Covers the shapes used in @vc/api-contract response DTOs.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return zodNode(schema, new Set());
}

function zodNode(schema: z.ZodTypeAny, seen: Set<z.ZodTypeAny>): JsonSchema {
  if (seen.has(schema)) return {};
  seen.add(schema);

  const def = (schema as unknown as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
  const typeName = def?.type as string | undefined;

  if (typeName === "optional" || typeName === "nullable") {
    const inner = def?.innerType as z.ZodTypeAny | undefined;
    if (!inner) return {};
    const innerSchema = zodNode(inner, seen);
    if (typeName === "nullable") {
      return { ...innerSchema, type: [innerSchema.type ?? "null", "null"].flat().filter((t, i, a) => a.indexOf(t) === i) };
    }
    return innerSchema;
  }

  if (typeName === "default") {
    const inner = def?.innerType as z.ZodTypeAny | undefined;
    return inner ? zodNode(inner, seen) : {};
  }

  if (typeName === "array") {
    const element = def?.element as z.ZodTypeAny | undefined;
    return {
      type: "array",
      items: element ? zodNode(element, seen) : {},
    };
  }

  if (typeName === "object") {
    const shape = def?.shape as Record<string, z.ZodTypeAny> | undefined;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    if (shape) {
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = zodNode(child, seen);
        const childDef = (child as { _zod?: { def?: { type?: string } } })._zod?.def;
        if (childDef?.type !== "optional" && childDef?.type !== "default") {
          required.push(key);
        }
      }
    }
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }

  if (typeName === "enum") {
    const entries = def?.entries as Record<string, string> | string[] | undefined;
    const values = Array.isArray(entries) ? entries : entries ? Object.values(entries) : [];
    return { type: "string", enum: values };
  }

  if (typeName === "string") {
    const out: JsonSchema = { type: "string" };
    if (typeof def?.minimum === "number") out.minLength = def.minimum;
    if (typeof def?.maximum === "number") out.maxLength = def.maximum;
    return out;
  }

  if (typeName === "number" || typeName === "int") {
    const out: JsonSchema = { type: "number" };
    if (typeName === "int") out.type = "integer";
    return out;
  }

  if (typeName === "boolean") return { type: "boolean" };

  if (typeName === "union") {
    const options = def?.options as z.ZodTypeAny[] | undefined;
    if (options?.length === 2) {
      const nullOpt = options.find((o) => (o as { _zod?: { def?: { type?: string } } })._zod?.def?.type === "null");
      const other = options.find((o) => o !== nullOpt);
      if (nullOpt && other) {
        const base = zodNode(other, seen);
        return { ...base, type: base.type === "string" ? ["string", "null"] : base.type };
      }
    }
  }

  return {};
}