import { Body, Controller, Headers, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { AddMembershipDto } from './dto/add-membership.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateUserDto) {
    await this.accessContextService.requireOperator(headers);
    return this.usersService.create(dto);
  }

  @Post('memberships')
  async addMembership(@Headers() headers: Record<string, unknown>, @Body() dto: AddMembershipDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.usersService.addMembership({
      ...dto,
      organizationId: dto.organizationId || context.organizationId!,
    });
  }
}
