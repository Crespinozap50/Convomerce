import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

// D-157 (docs/decisions.md): the project had no email delivery at all —
// tenant-user invitations only ever returned a raw token in the API
// response (dev/test convenience, exposed live on the pilot server today
// because of the NODE_ENV=development gap D-154 already flagged), with no
// real way to notify an invited person. One SMTP transport for every
// environment (nodemailer), pointed at MailHog locally (docker-compose.yml)
// and at Resend's SMTP relay in production — never two separate code paths
// to keep in sync, and never a place where a bug can only show up against
// a real inbox.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter;
  private readonly fromAddress: string;

  constructor(config: ConfigService) {
    this.fromAddress = config.get<string>('EMAIL_FROM_ADDRESS', 'onboarding@resend.dev');
    const user = config.get<string>('SMTP_USER', '');
    const password = config.get<string>('SMTP_PASSWORD', '');
    this.transporter = createTransport({
      host: config.get<string>('SMTP_HOST', 'localhost'),
      port: config.get<number>('SMTP_PORT', 51025),
      secure: config.get<string>('SMTP_SECURE', 'false') === 'true',
      auth: user ? { user, pass: password } : undefined,
    });
  }

  async send(to: string, subject: string, text: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.fromAddress, to, subject, text, html });
    } catch (error) {
      // Never lets a delivery failure (a typo'd address, the mail server
      // being briefly unreachable) take down the action that triggered it
      // — an invitation still gets created even if the email bounces; the
      // admin can always resend. Logged, not silently dropped.
      this.logger.error(
        JSON.stringify({ event: 'email_send_failed', to, subject }),
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
