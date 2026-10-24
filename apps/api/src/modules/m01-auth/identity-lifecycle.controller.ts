import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Ctx, CurrentCtx } from '../../common/context';
import { Roles } from '../../common/decorators';
import { IdentityLifecycleService } from './identity-lifecycle.service';

@Controller('identity/lifecycle-operations')
@Roles('R9')
export class IdentityLifecycleController {
  constructor(private readonly service: IdentityLifecycleService) {}

  @Post()
  create(@CurrentCtx() ctx: Ctx, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    return this.service.create(ctx, body, key);
  }

  @Get(':id')
  get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.service.get(ctx, id);
  }

  @Post(':id/reconcile')
  @HttpCode(200)
  reconcile(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.service.reconcile(ctx, id);
  }
}
