/**
 * Every failure, from every endpoint and from Fastify itself, leaves as the one envelope of
 * docs/PLATFORM.md §4.2. Unknown errors are logged with the request id and replaced by a generic `internal`.
 */
import type { ApiErrorBody } from '@instasupply/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, HTTP_STATUS, INTERNAL_MESSAGE } from './errors';

function fromFramework(
  error: FastifyError & { rateLimited?: boolean; retryAfterMs?: number },
): ApiError | null {
  if (error.rateLimited || error.statusCode === 429) {
    return new ApiError('resource-exhausted', 'Too many requests. Please slow down.', 'RATE_LIMITED', {
      retryAfterMs: typeof error.retryAfterMs === 'number' ? error.retryAfterMs : 60_000,
    });
  }
  switch (error.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
    case 'FST_REQ_FILE_TOO_LARGE':
    case 'FST_FILES_LIMIT':
      return new ApiError('invalid-argument', 'The request is too large.', null, {}, 413);
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
      return new ApiError('invalid-argument', 'Send the request as application/json.', null, {}, 415);
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_CONTENT_LENGTH':
      return new ApiError('invalid-argument', 'The request body is not valid JSON.');
    default:
      break;
  }
  // JSON syntax errors from the body parser carry statusCode 400.
  if (error.statusCode === 400 && (error instanceof SyntaxError || error.code === undefined)) {
    return new ApiError('invalid-argument', 'The request body is not valid JSON.');
  }
  if (error.statusCode === 400 && error.code?.startsWith('FST_')) {
    return new ApiError('invalid-argument', 'The request is not valid.');
  }
  return null;
}

export function sendApiError(reply: FastifyReply, error: ApiError): FastifyReply {
  const body: ApiErrorBody = {
    error: { status: error.status, code: error.code, message: error.message, details: error.details },
  };
  const retryAfterMs = error.details.retryAfterMs;
  if (typeof retryAfterMs === 'number')
    reply.header('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  else if (error.status === 'unavailable') reply.header('Retry-After', '1');
  reply.header('Cache-Control', 'no-store');
  return reply.code(error.httpStatus).type('application/json; charset=utf-8').send(body);
}

export function installErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((raw: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const error = raw instanceof ApiError ? raw : fromFramework(raw);
    if (error) {
      if (error.status === 'internal' || error.status === 'unavailable') {
        request.log.error({ err: raw, status: error.status }, error.message);
      }
      return sendApiError(reply, error);
    }
    request.log.error({ err: raw }, 'unhandled error');
    return sendApiError(reply, new ApiError('internal', INTERNAL_MESSAGE));
  });
  app.setNotFoundHandler((_request, reply) =>
    sendApiError(reply, new ApiError('not-found', 'There is nothing at this address.')),
  );
}

export { HTTP_STATUS };
