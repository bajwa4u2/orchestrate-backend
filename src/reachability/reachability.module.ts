import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { ReachabilityBuilderService } from './reachability-builder.service';
import { ReachabilityController } from './reachability.controller';

@Module({
  imports: [DatabaseModule, AccessContextModule],
  controllers: [ReachabilityController],
  providers: [ReachabilityBuilderService],
  exports: [ReachabilityBuilderService],
})
export class ReachabilityModule {}
