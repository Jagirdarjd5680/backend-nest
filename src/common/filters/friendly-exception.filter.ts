import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { isRouteNotFound, sendDecoy404 } from '../decoy-404';

/**
 * Nest's default filter serializes `exception.message` verbatim — for ThrottlerException that's
 * the literal string "ThrottlerException: Too Many Requests", which was leaking straight into
 * the mobile app's error banner. This swaps that one case for a friendly message while leaving
 * every other HttpException (including TemporaryBlockException's `{message, blockedUntil, code}`
 * body) passed through exactly as thrown.
 */
@Catch(HttpException)
export class FriendlyExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    if (exception instanceof ThrottlerException) {
      response.status(HttpStatus.TOO_MANY_REQUESTS).json({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many attempts. Please wait a moment and try again.',
      });
      return;
    }

    const body = exception.getResponse();
    // Unknown route: answer like an empty web server instead of "Cannot GET /api/…" (which names
    // the framework and confirms the path prefix).
    if (status === HttpStatus.NOT_FOUND && isRouteNotFound(typeof body === 'string' ? body : (body as any)?.message)) {
      return sendDecoy404(response);
    }
    response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
  }
}
