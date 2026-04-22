import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { QualificationController } from './qualification.controller';
import { QualificationService } from './qualification.service';

@Module({
  imports: [DatabaseModule, AccessContextModule],
  controllers: [QualificationController],
  providers: [QualificationService],
  exports: [QualificationService],
})
export class QualificationModule {}
