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
