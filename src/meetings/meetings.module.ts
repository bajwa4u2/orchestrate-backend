import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AccessContextModule } from '../access-context/access-context.module';

import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [
    DatabaseModule,
    AccessContextModule, // ✅ REQUIRED FIX
  ],
  controllers: [MeetingsController],
  providers: [MeetingsService],
  exports: [MeetingsService],
})
export class MeetingsModule {}