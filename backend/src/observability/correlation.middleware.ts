import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { validate as isUuid, v7 as uuidv7 } from 'uuid';
import { RequestWithCorrelation } from './request-context';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: RequestWithCorrelation, response: Response, next: NextFunction): void {
    const supplied = request.header('x-correlation-id');
    const correlationId = supplied && isUuid(supplied) ? supplied : uuidv7();
    request.correlationId = correlationId;
    response.setHeader('x-correlation-id', correlationId);
    next();
  }
}
