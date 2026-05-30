export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input") { super("VALIDATION_ERROR", message, 400); }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") { super("UNAUTHORIZED", message, 401); }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that") { super("FORBIDDEN", message, 403); }
}
export class NotFoundError extends AppError {
  constructor(message = "Not found") { super("NOT_FOUND", message, 404); }
}
export class ConflictError extends AppError {
  constructor(message = "Conflict") { super("CONFLICT", message, 409); }
}
export class BillingRequiredError extends AppError {
  constructor(message = "Billing is required for this action") { super("BILLING_REQUIRED", message, 402); }
}
export class RateLimitError extends AppError {
  constructor(message = "Rate limit exceeded") { super("RATE_LIMIT", message, 429); }
}
