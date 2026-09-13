import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { LocalAuthService } from './local-auth.service';
import { SessionAuthGuard } from './session-auth.guard';
import { PasswordReadyGuard } from './password-ready.guard';

@Module({
  imports: [
    // Security finding, this session: app.local_credentials' 5-attempt
    // lockout (010_local_authentication.sql) protects one known account
    // against repeated guessing, but nothing capped request VOLUME —
    // nothing stopped an attacker from either (a) relocking a specific
    // admin's account every 15 minutes indefinitely at near-zero cost, or
    // (b) trying one guess each against many different accounts, never
    // tripping any single account's lockout. Per-IP throttling closes both:
    // 10 login attempts/minute is generous for a real typo/retry, tight
    // enough to make either attack impractical. Scoped to AuthModule only
    // (see AuthController.login's @UseGuards) — not applied globally, so it
    // never throttles the SPA's own normal admin-panel traffic.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 10 }] }),
  ],
  controllers: [AuthController],
  providers: [LocalAuthService, SessionAuthGuard, PasswordReadyGuard],
  exports: [LocalAuthService, SessionAuthGuard, PasswordReadyGuard],
})
export class AuthModule {}
