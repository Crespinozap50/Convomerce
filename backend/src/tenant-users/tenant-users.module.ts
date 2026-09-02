import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantUsersController } from './tenant-users.controller';
import { TenantUsersService } from './tenant-users.service';

@Module({ imports: [AuthModule], controllers: [TenantUsersController], providers: [TenantUsersService] })
export class TenantUsersModule {}
