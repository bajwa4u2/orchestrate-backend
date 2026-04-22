import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { SignalDetectionService } from './signal-detection.service';
import { SignalsController } from './signals.controller';

@Module({
  imports: [DatabaseModule, AccessContextModule],
  controllers: [SignalsController],
  providers: [SignalDetectionService],
  exports: [SignalDetectionService],
})
export class SignalsModule {}
