/**
 * HttpError — application-level error carrying an HTTP status code and
 * optional structured details. Route code throws it for validation/domain
 * failures; the central errorHandler maps it to a JSON response.
 */
export class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}