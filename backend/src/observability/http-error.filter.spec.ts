import { ArgumentsHost } from '@nestjs/common';
import { HttpErrorFilter } from './http-error.filter';
import { unauthorized } from './http-errors';

describe('HttpErrorFilter', () => {
  it('preserves a stable application error code', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = hostWith(status);

    new HttpErrorFilter().catch(
      unauthorized('AUTH_INVALID_CREDENTIALS', 'Invalid email or password'), host,
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      statusCode: 401,
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      correlationId: 'test-correlation-id',
    });
  });

  it('uses a generic code for uncoded HTTP errors', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = hostWith(status);
    const { BadRequestException } = jest.requireActual('@nestjs/common');

    new HttpErrorFilter().catch(new BadRequestException('Invalid input'), host);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REQUEST_REJECTED' }));
  });

  // Found live testing an oversized request body: body-parser rejects it
  // via the `http-errors` package before Nest's own pipeline runs — a
  // plain Error with a numeric `.statusCode` (413) and `.expose = true`,
  // never a NestJS HttpException. Used to surface as a raw 500, which both
  // gave the caller the wrong status code and polluted error-level logs
  // with what looked like a genuine crash.
  it('maps an Express/body-parser client error (413, not an HttpException) to its real status, not 500', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = hostWith(status);
    const payloadTooLarge = Object.assign(new Error('request entity too large'), {
      statusCode: 413,
      expose: true,
    });

    new HttpErrorFilter().catch(payloadTooLarge, host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'request entity too large',
      correlationId: 'test-correlation-id',
    });
  });

  it('still treats a genuinely unexpected error as a generic 500, not a fabricated 4xx', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = hostWith(status);

    new HttpErrorFilter().catch(new Error('unexpected null pointer somewhere'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      correlationId: 'test-correlation-id',
    });
  });
});

function hostWith(status: jest.Mock): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', path: '/test', correlationId: 'test-correlation-id' }),
      getResponse: () => ({ status }),
      getNext: jest.fn(),
    }),
  } as unknown as ArgumentsHost;
}
