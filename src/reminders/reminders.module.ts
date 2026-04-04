import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { EmailsModule } from '../emails/emails.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [AccessContextModule, EmailsModule],
  controllers: [RemindersController],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
