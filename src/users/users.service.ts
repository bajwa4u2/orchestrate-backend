import { Injectable } from '@nestjs/common';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { AddMembershipDto } from './dto/add-membership.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateUserDto) {
    return this.prisma.user.create({
      data: {
        email: dto.email,
        fullName: dto.fullName,
        passwordHash: dto.passwordHash,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
    });
  }

  addMembership(dto: AddMembershipDto) {
    return this.prisma.workspaceMember.create({
      data: {
        organizationId: dto.organizationId,
        userId: dto.userId,
        role: dto.role,
        isActive: dto.isActive,
      },
    });
  }
}
