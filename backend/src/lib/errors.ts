export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details?: unknown, code = 'VALIDATION_ERROR') {
    super(400, code, message, details);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this', code = 'FORBIDDEN') {
    super(403, code, message);
  }
}
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(404, code, message);
  }
}
export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT', details?: unknown) {
    super(409, code, message, details);
  }
}
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', code = 'RATE_LIMITED') {
    super(429, code, message);
  }
}
