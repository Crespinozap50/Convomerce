import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';

@Module({ imports: [AuthModule], controllers: [PlatformTenantsController], providers: [PlatformTenantsService] })
export class PlatformTenantsModule {}
