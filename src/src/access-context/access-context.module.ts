import { Module } from '@nestjs/common';
import { AccessContextService } from './access-context.service';

@Module({
  providers: [AccessContextService],
  exports: [AccessContextService],
})
export class AccessContextModule {}
