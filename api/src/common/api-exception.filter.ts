import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { isDatabaseUnavailable } from '../database/pg-errors.js';
import { DomainError, type DomainErrorCode } from './domain-errors.js';

const STATUS_BY_DOMAIN_CODE: Record<DomainErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  NAME_CONFLICT: HttpStatus.CONFLICT,
  PARENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  FOLDER_NOT_FOUND: HttpStatus.NOT_FOUND,
  FILE_NOT_FOUND: HttpStatus.NOT_FOUND,
};

interface ApiError {
  status: number;
  code: string;
  message: string;
}

function toApiError(exception: unknown): ApiError {
  if (exception instanceof DomainError) {
    return {
      status: STATUS_BY_DOMAIN_CODE[exception.code],
      code: exception.code,
      message: exception.message,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    
    return {
      status,
      code: HttpStatus[status] ?? 'HTTP_ERROR',
      message: exception.message
    };
  }

  if (isDatabaseUnavailable(exception)) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable',
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, code, message } = toApiError(exception);

    if (status >= 500) {
      // Log the stack trace for server errors.
      // I don't want to log the stack trace for
      // client errors because they are expected
      // and not a bug in the code.
      const detail = exception instanceof Error
        ? exception.stack
        : String(exception);
      this.logger.error(`${code}: ${detail}`);
    }

    host.switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ error: { code, message } });
  }
}
