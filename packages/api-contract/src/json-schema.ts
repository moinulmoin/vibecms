import { z } from "zod";

type JsonSchema = Record<string, unknown>;

/** Request fields with defaults remain optional, matching input parsing. */
export function zodToInputJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
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
