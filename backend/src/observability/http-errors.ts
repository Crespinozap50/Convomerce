import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
  ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException,
} from '@nestjs/common';

type ErrorBody = { code: string; message: string };
export const badRequest = (code: string, message: string) => new BadRequestException({ code, message } satisfies ErrorBody);
export const unauthorized = (code: string, message: string) => new UnauthorizedException({ code, message } satisfies ErrorBody);
export const forbidden = (code: string, message: string) => new ForbiddenException({ code, message } satisfies ErrorBody);
export const conflict = (code: string, message: string) => new ConflictException({ code, message } satisfies ErrorBody);
export const notFound = (code: string, message: string) => new NotFoundException({ code, message } satisfies ErrorBody);
export const unprocessable = (code: string, message: string) => new UnprocessableEntityException({ code, message } satisfies ErrorBody);
export const unavailable = (code: string, message: string) => new ServiceUnavailableException({ code, message } satisfies ErrorBody);
