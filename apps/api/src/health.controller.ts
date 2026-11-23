import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { readonly status: 'ok' } {
    return { status: 'ok' };
  }
}
