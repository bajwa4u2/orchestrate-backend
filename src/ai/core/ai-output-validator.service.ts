import { Injectable } from '@nestjs/common';
import { AiJsonSchema } from '../contracts/ai-core.contract';

export interface AiValidationResult {
  valid: boolean;
  issues: string[];
}

@Injectable()
export class AiOutputValidatorService {
  validate(output: unknown, schema?: AiJsonSchema): AiValidationResult {
    if (!schema?.schema) return { valid: true, issues: [] };
    const issues: string[] = [];
    this.validateSchema(output, schema.schema, 'root', issues);
    return { valid: issues.length === 0, issues };
  }

  private validateSchema(value: unknown, schema: Record<string, any>, path: string, issues: string[]) {
    const type = schema.type;
    if (type && !this.typeMatches(value, type)) {
      issues.push(`${path} expected ${type}, got ${Array.isArray(value) ? 'array' : typeof value}`);
      return;
    }

    if (type === 'object' || (schema.properties && value && typeof value === 'object' && !Array.isArray(value))) {
      const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      for (const required of schema.required ?? []) {
        if (obj[required] === undefined || obj[required] === null) issues.push(`${path}.${required} is required`);
      }
      if (schema.additionalProperties === false) {
        const allowed = new Set(Object.keys(schema.properties ?? {}));
        for (const key of Object.keys(obj)) {
          if (!allowed.has(key)) issues.push(`${path}.${key} is not allowed by schema`);
        }
      }
      for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
        if (obj[key] !== undefined && childSchema && typeof childSchema === 'object') {
          this.validateSchema(obj[key], childSchema as Record<string, any>, `${path}.${key}`, issues);
        }
      }
    }

    if (type === 'array' && Array.isArray(value) && schema.items) {
      value.slice(0, 50).forEach((item, index) => this.validateSchema(item, schema.items, `${path}[${index}]`, issues));
    }

    if (schema.enum && !schema.enum.includes(value)) issues.push(`${path} must be one of: ${schema.enum.join(', ')}`);
  }

  private typeMatches(value: unknown, type: string | string[]) {
    if (Array.isArray(type)) return type.some((item) => this.typeMatches(value, item));
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return Boolean(value && typeof value === 'object' && !Array.isArray(value));
    if (type === 'integer') return Number.isInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'null') return value === null;
    return typeof value === type;
  }
}
