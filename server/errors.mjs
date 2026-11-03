export class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message); this.status = status; this.code = code; this.extra = extra;
  }
}

export function validationError(message) { return new AppError(422, 'validation', message); }
