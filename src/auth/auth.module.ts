import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [AccessContextModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
