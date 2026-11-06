import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class RequireJsonGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    // Only care about JSON payload
    if (req.is('application/json') === false) {
      throw new UnsupportedMediaTypeException(
        'Content-Type must be application/json'
      );
    }
    return true;
  }
}
