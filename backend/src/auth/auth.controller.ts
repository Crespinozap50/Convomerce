import {
  Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from './authenticated-request';
import { LocalAuthService } from './local-auth.service';
import { SessionAuthGuard } from './session-auth.guard';
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session-cookie';
import { badRequest } from '../observability/http-errors';

@Controller('v1/auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(private readonly auth: LocalAuthService, config: ConfigService) {
    this.secureCookie = config.get<string>('NODE_ENV') === 'production';
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response,
  ) {
    const credentials = parseCredentials(body);
    const session = await this.auth.login(
      credentials.email, credentials.password, request.ip || null,
      request.header('user-agent') ?? '',
    );
    setSessionCookie(response, session.token, session.expiresAt, this.secureCookie);
    return { authenticated: true, expiresAt: session.expiresAt, mustChangePassword: session.mustChangePassword };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const token = readSessionToken(request);
    if (token) await this.auth.logout(token);
    clearSessionCookie(response, this.secureCookie);
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(@Req() request: AuthenticatedRequest) {
    const context = await this.auth.userContext(request.actor.userId);
    if (!context) return { authenticated: false };
    return { ...context, sessionExpiresAt: request.actor.sessionExpiresAt };
  }

  @Post('change-password')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async changePassword(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<void> {
    const passwords = parsePasswordChange(body);
    await this.auth.changePassword(
      request.actor.userId, request.actor.sessionId,
      passwords.currentPassword, passwords.newPassword,
    );
  }

  @Patch('preferences')
  @UseGuards(SessionAuthGuard)
  async updatePreferences(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const locale = parseLocale(body);
    await this.auth.updateInterfaceLocale(request.actor.userId, request.actor.sessionId, locale);
    return { uiLanguage: locale };
  }
}

function parseLocale(body: unknown): 'en' | 'es' {
  if (!body || typeof body !== 'object') throw badRequest('VALIDATION_ERROR', 'Invalid preferences');
  const locale = (body as Record<string, unknown>).uiLanguage;
  if (locale !== 'en' && locale !== 'es') throw badRequest('VALIDATION_ERROR', 'Unsupported interface locale');
  return locale;
}

function parseCredentials(body: unknown): { email: string; password: string } {
  if (!body || typeof body !== 'object') throw badRequest('VALIDATION_ERROR', 'Invalid credentials');
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || email.length > 320 || !/^\S+@\S+\.\S+$/.test(email)) {
    throw badRequest('VALIDATION_ERROR', 'Invalid email');
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw badRequest('VALIDATION_ERROR', 'Password must be between 12 and 256 characters');
  }
  return { email, password };
}

function parsePasswordChange(body: unknown): { currentPassword: string; newPassword: string } {
  if (!body || typeof body !== 'object') throw badRequest('VALIDATION_ERROR', 'Invalid passwords');
  const { currentPassword, newPassword } = body as Record<string, unknown>;
  if (typeof currentPassword !== 'string' || currentPassword.length < 12 || currentPassword.length > 256) {
    throw badRequest('VALIDATION_ERROR', 'Current password is invalid');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 256) {
    throw badRequest('VALIDATION_ERROR', 'New password must be between 12 and 256 characters');
  }
  return { currentPassword, newPassword };
}
