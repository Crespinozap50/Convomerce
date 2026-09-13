import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { RequestWithCorrelation } from './request-context';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithCorrelation>();
    const response = http.getResponse<Response>();
    // Found live testing an oversized request body: body-parser (and other
    // Express-ecosystem middleware — multer, etc.) reject it BEFORE Nest's
    // own request pipeline ever runs, via the `http-errors` package's plain
    // Error with a numeric `.statusCode`/`.status` (413 here) — never a
    // NestJS HttpException. The `instanceof HttpException` check alone
    // always missed this, surfacing a real, well-understood client mistake
    // ("request entity too large") as a raw 500 — wrong status code for the
    // caller, and it also polluted error-level logs with what looks like a
    // genuine crash, which can bury real 500s in the noise.
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : expressClientErrorStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const message = status >= 500 ? 'Internal server error' : safeMessage(exception);
    const code = status >= 500 ? 'INTERNAL_ERROR' : safeCode(exception);

    if (status >= 500) {
      this.logger.error(JSON.stringify({
        event: 'http_error', method: request.method, path: request.path,
        status, correlationId: request.correlationId,
        exceptionMessage: exception instanceof Error ? exception.message : String(exception),
      }), exception instanceof Error ? exception.stack : undefined);
    }
    response.status(status).json({ statusCode: status, code, message, correlationId: request.correlationId });
  }
}

function safeMessage(exception: unknown): string {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response && 'message' in response) {
      const message = (response as { message: unknown }).message;
      return Array.isArray(message) ? message.join(', ') : String(message);
    }
    return exception.message;
  }
  // http-errors (body-parser, multer, ...) sets `.expose = true` on 4xx
  // errors specifically to mark their `.message` safe to show a client —
  // the same signal the library itself uses to decide this. Anything
  // without that explicit flag falls back to a generic message rather than
  // trusting an arbitrary thrown value's .message.
  if (isExposedError(exception)) return exception.message;
  return 'Request rejected';
}

function safeCode(exception: unknown): string {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'object' && response && 'code' in response) {
      const code = String((response as { code: unknown }).code);
      if (/^[A-Z][A-Z0-9_]+$/.test(code)) return code;
    }
    return 'REQUEST_REJECTED';
  }
  if (expressClientErrorStatus(exception) === HttpStatus.PAYLOAD_TOO_LARGE) return 'PAYLOAD_TOO_LARGE';
  return 'REQUEST_REJECTED';
}

function expressClientErrorStatus(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const candidate = exception as { statusCode?: unknown; status?: unknown };
  const raw = candidate.statusCode ?? candidate.status;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 400 && raw < 500 ? raw : null;
}

function isExposedError(exception: unknown): exception is Error & { expose: true } {
  return (
    exception instanceof Error &&
    (exception as { expose?: unknown }).expose === true &&
    expressClientErrorStatus(exception) !== null
  );
}
