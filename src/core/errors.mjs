export class TeamError extends Error {
  constructor(code, message, details = {}, options) {
    super(message, options);
    this.name = 'TeamError';
    this.code = code;
    this.details = { retryable: false, ...details };
  }
  toJSON() { return { code: this.code, message: this.message, details: this.details }; }
}

export function invariant(condition, code, message, details = {}) {
  if (!condition) throw new TeamError(code, message, details);
}
