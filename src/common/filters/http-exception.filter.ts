import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as { message: string }).message;

    // Some rejections are lists, not sentences: a bulk write refused because
    // three of its thirty entries are wrong has to say *which* three, and a
    // message string cannot carry that usefully. Thrown as
    // `new BadRequestException({ message, errors })`, and absent everywhere
    // else — so nothing that does not opt in changes shape.
    const errors =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as { errors?: unknown }).errors
        : undefined;

    response.status(status).json({
      success: false,
      message,
      ...(errors !== undefined && { errors }),
      data: null,
    });
  }
}
