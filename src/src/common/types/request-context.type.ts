import { MemberRole } from '@prisma/client';

export type AccessSurface = 'operator' | 'client' | 'system';

export interface RequestContext {
  userId?: string;
  organizationId?: string;
  clientId?: string;
  memberRole?: MemberRole;
  surface?: AccessSurface;
  membershipId?: string;
  email?: string;
}
