export type RouteSurface = 'public' | 'client' | 'operator' | 'client/operator' | 'webhook' | 'internal';
export type RouteGuard = 'none' | 'requireClient' | 'requireOperator' | 'secretOrSignature' | 'internalSecret';

export type AuthorizationMatrixEntry = {
  method: string;
  path: string;
  surface: RouteSurface;
  guard: RouteGuard;
  notes?: string;
};

export const AUTHORIZATION_MATRIX: AuthorizationMatrixEntry[] = [
  { method: 'GET', path: '/v1/health', surface: 'public', guard: 'none', notes: 'Sanitized health only.' },
  { method: 'GET', path: '/v1/health/live', surface: 'public', guard: 'none' },
  { method: 'GET', path: '/v1/health/ready', surface: 'public', guard: 'none', notes: 'No secrets or internals.' },
  { method: 'GET', path: '/v1/health/authorization-matrix', surface: 'operator', guard: 'requireOperator' },
  { method: 'POST', path: '/v1/billing/webhook', surface: 'webhook', guard: 'secretOrSignature' },
  { method: 'POST', path: '/v1/emails/inbound', surface: 'webhook', guard: 'secretOrSignature' },
  { method: 'POST', path: '/v1/emails/webhook', surface: 'webhook', guard: 'secretOrSignature' },
  { method: 'POST', path: '/v1/replies/inbound', surface: 'webhook', guard: 'secretOrSignature' },
  { method: 'ALL', path: '/v1/public/*', surface: 'public', guard: 'none' },
  { method: 'ALL', path: '/v1/auth/*', surface: 'public', guard: 'none', notes: 'Auth endpoints validate credentials/tokens.' },
  { method: 'ALL', path: '/v1/client/*', surface: 'client', guard: 'requireClient' },
  { method: 'GET', path: '/v1/clients/me/*', surface: 'client', guard: 'requireClient' },
  { method: 'POST', path: '/v1/clients/me/*', surface: 'client', guard: 'requireClient' },
  { method: 'POST', path: '/v1/billing/subscribe', surface: 'client', guard: 'requireClient' },
  { method: 'GET', path: '/v1/billing/subscription', surface: 'client', guard: 'requireClient' },
  { method: 'POST', path: '/v1/billing/portal', surface: 'client', guard: 'requireClient' },
  { method: 'GET', path: '/v1/emails/dispatches/me', surface: 'client', guard: 'requireClient' },
  { method: 'GET', path: '/v1/replies', surface: 'client/operator', guard: 'requireClient', notes: 'Falls back to operator only when client auth fails.' },
  { method: 'ALL', path: '/v1/operator/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/ai/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/campaigns/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/leads/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/execution/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/sources/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/providers/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/deliverability/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/organizations/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/users/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/invoices/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/statements/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/agreements/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/notifications/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/templates/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/analytics/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/control/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/workflows/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/strategy/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/signals/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/qualification/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/reachability/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/adaptation/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/meetings/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/reminders/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'ALL', path: '/v1/subscriptions/*', surface: 'operator', guard: 'requireOperator' },
  { method: 'GET', path: '/v1/emails/dispatches', surface: 'operator', guard: 'requireOperator' },
  { method: 'POST', path: '/v1/emails/send-template', surface: 'operator', guard: 'requireOperator' },
];

export function matrixSummary() {
  return AUTHORIZATION_MATRIX.reduce<Record<string, number>>((acc, item) => {
    acc[item.guard] = (acc[item.guard] ?? 0) + 1;
    return acc;
  }, {});
}
