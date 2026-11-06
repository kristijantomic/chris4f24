import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ValidationFailedError } from './domain-errors.js';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    
    if (result.success) return result.data;

    const message = result.error.issues
      .map(({ path, message }) => (
        path.length > 0 ? `${path.join('.')}: ${message}` : message)
      ).join('; ');

    throw new ValidationFailedError(message);
  }
}
