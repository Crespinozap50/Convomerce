import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { LocalAuthService } from './local-auth.service';
import { SessionAuthGuard } from './session-auth.guard';
import { PasswordReadyGuard } from './password-ready.guard';

@Module({
  controllers: [AuthController],
  providers: [LocalAuthService, SessionAuthGuard, PasswordReadyGuard],
  exports: [LocalAuthService, SessionAuthGuard, PasswordReadyGuard],
})
export class AuthModule {}
