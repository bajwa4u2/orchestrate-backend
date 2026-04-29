export type StructuredLogLevel = 'info' | 'warn' | 'error';

export function structuredLog(
  level: StructuredLogLevel,
  event: string,
  fields: Record<string, unknown> = {},
) {
  const payload = {
    level,
    event,
    service: 'orchestrate-backend',
    timestamp: new Date().toISOString(),
    ...fields,
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}
