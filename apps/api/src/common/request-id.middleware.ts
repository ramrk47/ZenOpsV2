import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createJsonLogger, ensureRequestId } from '@zenops/common';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = createJsonLogger();

  use(req: FastifyRequest & { requestId?: string }, res: FastifyReply, next: () => void) {
    const requestId = ensureRequestId((req.headers['x-request-id'] as string | undefined) ?? undefined);
    req.requestId = requestId;
    res.header('x-request-id', requestId);
    this.logger.info('request_received', {
      request_id: requestId,
      method: req.method,
      path: req.url
    });
    res.raw.on('finish', () => {
      this.logger.info('request_completed', {
        request_id: requestId,
        method: req.method,
        path: req.url,
        status_code: res.raw.statusCode
      });
    });
    next();
  }
}
