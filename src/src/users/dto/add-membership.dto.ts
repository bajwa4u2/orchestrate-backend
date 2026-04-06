import { MemberRole } from '@prisma/client';
import { IsBoolean, IsIn, IsString } from 'class-validator';

const memberRoles = ['OWNER', 'ADMIN', 'OPERATOR', 'ANALYST', 'BILLING', 'VIEWER'] satisfies MemberRole[];

export class AddMembershipDto {
  @IsString()
  organizationId!: string;

  @IsString()
  userId!: string;

  @IsIn(memberRoles)
  role!: MemberRole;

  @IsBoolean()
  isActive: boolean = true;
}
