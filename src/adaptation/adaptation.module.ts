import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { AdaptationController } from './adaptation.controller';
import { AdaptationService } from './adaptation.service';

@Module({
  imports: [DatabaseModule, AccessContextModule],
  controllers: [AdaptationController],
  providers: [AdaptationService],
  exports: [AdaptationService],
})
export class AdaptationModule {}
