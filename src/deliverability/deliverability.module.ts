import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { DeliverabilityController } from './deliverability.controller';
import { DeliverabilityService } from './deliverability.service';

@Module({
  imports: [DatabaseModule, AccessContextModule],
  controllers: [DeliverabilityController],
  providers: [DeliverabilityService],
  exports: [DeliverabilityService],
})
export class DeliverabilityModule {}
