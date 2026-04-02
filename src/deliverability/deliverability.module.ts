import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DeliverabilityController } from './deliverability.controller';
import { DeliverabilityService } from './deliverability.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DeliverabilityController],
  providers: [DeliverabilityService],
  exports: [DeliverabilityService],
})
export class DeliverabilityModule {}
