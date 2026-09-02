import {
  CallHandler, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { RequestWithCorrelation } from './request-context';
import { MetricsService } from '../metrics/metrics.service';
import { Response } from 'express';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithCorrelation>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();
    return next.handle().pipe(tap({
      next: () => this.record(request, response.statusCode, Date.now() - startedAt, 'completed'),
      error: (error) => this.record(
        request,
        error instanceof HttpException ? error.getStatus() : 500,
        Date.now() - startedAt,
        'failed',
      ),
    }));
  }

  private record(
    request: RequestWithCorrelation,
    status: number,
    durationMs: number,
    outcome: string,
  ): void {
    this.metrics.observeHttp(request.method, request.path, status, durationMs);
    this.logger.log(JSON.stringify({
      event: 'http_request', method: request.method, path: request.path,
      status, outcome, durationMs, correlationId: request.correlationId,
    }));
  }
}
