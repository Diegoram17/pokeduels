/**
 * asyncHandler — wraps an async route handler so rejected promises are
 * forwarded to Express's error middleware instead of crashing the process.
 * Explicit wrapper: does not depend on an Express major version's automatic
 * async error handling.
 *
 * @param {(req, res, next) => Promise<unknown>} fn
 * @returns {(req, res, next) => Promise<unknown>}
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    try {
      return Promise.resolve(fn(req, res, next)).catch(next);
    } catch (err) {
      // A synchronous throw inside fn escapes `Promise.resolve(fn(...))`
      // because the argument is evaluated before the promise exists; catch it
      // here so the wrapper forwards ALL failures to next, not just rejections.
      next(err);
    }
  };
}