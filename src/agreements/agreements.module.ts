import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';

@Module({
  imports: [AccessContextModule],
  controllers: [AgreementsController],
  providers: [AgreementsService],
  exports: [AgreementsService],
})
export class AgreementsModule {}
