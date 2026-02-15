import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createJsonLogger, ensureRequestId } from '@zenops/common';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = createJsonLogger();

  use(req: FastifyRequest & { requestId?: string }, res: FastifyReply | ServerResponse, next: () => void) {
    const requestId = ensureRequestId((req.headers['x-request-id'] as string | undefined) ?? undefined);
    const response = 'raw' in res ? res.raw : res;

    req.requestId = requestId;
    response.setHeader('x-request-id', requestId);

    this.logger.info('request_received', {
      request_id: requestId,
      method: req.method,
      path: req.url
    });

    response.on('finish', () => {
      this.logger.info('request_completed', {
        request_id: requestId,
        method: req.method,
        path: req.url,
        status_code: response.statusCode
      });
    });

    next();
  }
}
