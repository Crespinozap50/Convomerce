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
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
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
  if (!(exception instanceof HttpException)) return 'Request rejected';
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (typeof response === 'object' && response && 'message' in response) {
    const message = (response as { message: unknown }).message;
    return Array.isArray(message) ? message.join(', ') : String(message);
  }
  return exception.message;
}

function safeCode(exception: unknown): string {
  if (!(exception instanceof HttpException)) return 'REQUEST_REJECTED';
  const response = exception.getResponse();
  if (typeof response === 'object' && response && 'code' in response) {
    const code = String((response as { code: unknown }).code);
    if (/^[A-Z][A-Z0-9_]+$/.test(code)) return code;
  }
  return 'REQUEST_REJECTED';
}
