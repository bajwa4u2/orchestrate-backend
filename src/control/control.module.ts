import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { ControlController } from './control.controller';
import { ControlService } from './control.service';

@Module({
  imports: [DatabaseModule, AccessContextModule],
  controllers: [ControlController],
  providers: [ControlService],
  exports: [ControlService],
})
export class ControlModule {}
