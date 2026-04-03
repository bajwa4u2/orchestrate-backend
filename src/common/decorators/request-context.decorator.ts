import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestContext } from '../types/request-context.type';

export const CurrentContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest();
    return (request.orchestrateContext ?? {}) as RequestContext;
  },
);
