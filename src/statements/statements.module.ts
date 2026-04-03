import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { StatementsController } from './statements.controller';
import { StatementsService } from './statements.service';

@Module({
  imports: [AccessContextModule],
  controllers: [StatementsController],
  providers: [StatementsService],
  exports: [StatementsService],
})
export class StatementsModule {}
