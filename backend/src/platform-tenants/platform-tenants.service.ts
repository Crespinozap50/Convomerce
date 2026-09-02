import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { conflict, forbidden, notFound } from '../observability/http-errors';

export interface PlatformTenant {
  id: string; slug: string; displayName: string; status: string; timezone: string; defaultLocale: string;
}

@Injectable()
export class PlatformTenantsService {
  constructor(private readonly database: DatabaseService) {}

  async list(actorUserId: string): Promise<PlatformTenant[]> {
    try {
      return await this.database.withRuntimeTransaction(async client => {
        const result = await client.query<{id:string;slug:string;display_name:string;status:string;timezone:string;default_locale:string}>(
          'select * from app.list_platform_tenants($1)', [actorUserId],
        );
        return result.rows.map(row => ({ id: row.id, slug: row.slug, displayName: row.display_name,
          status: row.status, timezone: row.timezone, defaultLocale: row.default_locale }));
      });
    } catch (error) {
      if (isPgCode(error, '42501')) throw forbidden('PLATFORM_TENANT_FORBIDDEN', 'Only a platform owner can view all companies');
      throw error;
    }
  }

  async create(actorUserId: string, input: {slug:string;displayName:string;timezone:string;defaultLocale:string}) {
    const tenantId = uuidv7();
    try {
      await this.database.withRuntimeTransaction(client => client.query(
        'select app.create_platform_tenant($1,$2,$3,$4,$5,$6,$7)',
        [actorUserId, tenantId, uuidv7(), input.slug, input.displayName, input.timezone, input.defaultLocale],
      ));
      return { tenantId, created: true };
    } catch (error) {
      if (isPgCode(error, '42501')) throw forbidden('PLATFORM_TENANT_FORBIDDEN', 'Only a platform owner can create companies');
      if (isPgCode(error, '23505')) throw conflict('PLATFORM_TENANT_DUPLICATE', 'A company with this identifier already exists');
      throw error;
    }
  }

  async update(actorUserId: string, tenantId: string, input: {displayName:string;timezone:string;defaultLocale:string;status:string}) {
    try {
      await this.database.withRuntimeTransaction(client => client.query(
        'select app.update_platform_tenant($1,$2,$3,$4,$5,$6)',
        [actorUserId, tenantId, input.displayName, input.timezone, input.defaultLocale, input.status],
      ));
      return { tenantId, updated: true };
    } catch (error) {
      if (isPgCode(error, '42501')) throw forbidden('PLATFORM_TENANT_FORBIDDEN', 'Only a platform owner can update companies');
      if (isPgCode(error, 'P0002')) throw notFound('PLATFORM_TENANT_NOT_FOUND', 'Company not found');
      throw error;
    }
  }
}

function isPgCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as {code?:string}).code === code;
}
