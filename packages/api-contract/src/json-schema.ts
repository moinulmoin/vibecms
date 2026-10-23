import { z } from "zod";

type JsonSchema = Record<string, unknown>;

/**
 * MCP tool input schema. Request fields with defaults remain optional,
 * matching input parsing. MCP requires `type: "object"` at the top, and
 * Claude's API rejects top-level anyOf/oneOf, so a union of object shapes is
 * advertised as one object; the request parser still enforces the union.
 */
export function zodToInputJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const converted = z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
  const options = (converted.anyOf ?? converted.oneOf) as JsonSchema[] | undefined;
  if (!Array.isArray(options) || !options.every((option) => option.type === "object")) return converted;

  const properties: Record<string, unknown> = {};
  for (const option of options) {
    for (const [key, value] of Object.entries((option.properties ?? {}) as Record<string, unknown>)) {
      properties[key] ??= value;
    }
  }
  const requiredSets = options.map((option) => new Set((option.required ?? []) as string[]));
  const required = [...requiredSets[0]!].filter((key) => requiredSets.every((set) => set.has(key)));
  const exclusive = [...new Set(requiredSets.flatMap((set) => [...set]))].filter((key) => !required.includes(key));
  const { anyOf: _anyOf, oneOf: _oneOf, ...rest } = converted;
  return {
    ...rest,
    type: "object",
    ...(exclusive.length > 1 ? { description: `Send exactly one of: ${exclusive.join(", ")}.` } : {}),
    properties,
    ...(required.length ? { required } : {}),
    ...(options.every((option) => option.additionalProperties === false) ? { additionalProperties: false } : {}),
  };
}

/** Zod's converter preserves reused shapes and discriminated unions. */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const converted = z.toJSONSchema(schema, { reused: 'ref' }) as JsonSchema;
  const options = converted.anyOf;
  if (Array.isArray(options) && options.length === 2) {
    const nullOption = options.find((item) => (item as JsonSchema).type === 'null');
    const other = options.find((item) => item !== nullOption) as JsonSchema | undefined;
    if (nullOption && other && typeof other.type === 'string') {
      return { ...other, type: [other.type, 'null'],
        ...(converted.$defs ? { $defs: converted.$defs } : {}) };
    }
  }
  return converted;
}
