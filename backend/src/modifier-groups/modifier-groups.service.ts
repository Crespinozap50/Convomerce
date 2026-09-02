import { Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { DatabaseService } from "../database/database.service";
import { forbidden, notFound } from "../observability/http-errors";

export type SelectionType = "single" | "multiple";
export type ModifierGroupInput = { name: string; selectionType: SelectionType };
export type ModifierOptionInput = { name: string; priceMinor: number; currency: string };

@Injectable()
export class ModifierGroupsService {
  constructor(private readonly db: DatabaseService) {}

  list(tenantId: string, userId: string) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("MODIFIER_GROUPS_FORBIDDEN", "Actor cannot manage extras");
      const groups = await client.query<{
        id: string; name: string; selection_type: SelectionType; status: string;
      }>(`select id,name,selection_type,status from app.modifier_groups where status<>'archived' order by name`);
      const options = await client.query<{
        id: string; modifier_group_id: string; name: string;
        price_delta_minor: string; currency: string; status: string;
      }>(
        `select id,modifier_group_id,name,price_delta_minor::text,currency,status
           from app.modifier_options where status<>'archived' order by sort_order,name`,
      );
      const links = await client.query<{ catalog_item_id: string; modifier_group_id: string }>(
        `select catalog_item_id,modifier_group_id from app.item_modifier_groups`,
      );
      const items = await client.query<{ id: string; name: string }>(
        `select id,name from app.catalog_items where status='active' order by name`,
      );
      return {
        items: items.rows,
        groups: groups.rows.map((group) => ({
          id: group.id,
          name: group.name,
          selectionType: group.selection_type,
          status: group.status,
          options: options.rows
            .filter((option) => option.modifier_group_id === group.id)
            .map((option) => ({
              id: option.id,
              name: option.name,
              priceMinor: Number(option.price_delta_minor),
              currency: option.currency,
              status: option.status,
            })),
          assignedItemIds: links.rows
            .filter((link) => link.modifier_group_id === group.id)
            .map((link) => link.catalog_item_id),
        })),
      };
    });
  }

  createGroup(tenantId: string, userId: string, input: ModifierGroupInput) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("MODIFIER_GROUPS_FORBIDDEN", "Actor cannot manage extras");
      const id = uuidv7();
      await client.query(
        `insert into app.modifier_groups(id,tenant_id,name,selection_type,min_selections,max_selections,status)
         values($1,$2,$3,$4,0,$5,'active')`,
        [id, tenantId, input.name, input.selectionType, input.selectionType === "single" ? 1 : null],
      );
      return { id };
    });
  }

  updateGroup(tenantId: string, userId: string, groupId: string, input: ModifierGroupInput) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("MODIFIER_GROUPS_FORBIDDEN", "Actor cannot manage extras");
      const result = await client.query(
        `update app.modifier_groups set name=$2,selection_type=$3,max_selections=$4,updated_at=now()
          where id=$1 and status<>'archived' returning id`,
        [groupId, input.name, input.selectionType, input.selectionType === "single" ? 1 : null],
      );
      if (!result.rows[0]) throw notFound("MODIFIER_GROUP_NOT_FOUND", "Extras group was not found");
      return { updated: true };
    });
  }

  archiveGroup(tenantId: string, userId: string, groupId: string) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("MODIFIER_GROUPS_FORBIDDEN", "Actor cannot manage extras");
      const result = await client.query(
        `update app.modifier_groups set status='archived',updated_at=now() where id=$1 and status<>'archived' returning id`,
        [groupId],
      );
      if (!result.rows[0]) throw notFound("MODIFIER_GROUP_NOT_FOUND", "Extras group was not found");
      await client.query(
        `update app.modifier_options set status='archived',updated_at=now() where modifier_group_id=$1 and status<>'archived'`,
        [groupId],
      );
      return { archived: true };
    });
  }

  createOption(tenantId: string, userId: string, groupId: string, input: ModifierOptionInput) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("MODIFIER_GROUPS_FORBIDDEN", "Actor cannot manage extras");
      const group = await client.query(
        `select id from app.modifier_groups where id=$1 and status<>'archived'`,
        [groupId],
      );
      if (!group.rows[0]) throw notFound("MODIFIER_GROUP_NOT_FOUND", "Extras group was not found");
      const id = uuidv7();
      await client.query(
        `insert into app.modifier_options(id,tenant_id,modifier_group_id,name,price_delta_minor,currency,status,sort_order)
         values($1,$2,$3,$4,$5,$6,'active',(select coalesce(max(sort_order),0)+1 from app.modifier_options where modifier_group_id=$3))`,
        [id, tenantId, groupId, input.name, input.priceMinor, input.currency],
      );
      return { id };
    });
  }

  updateOption(
    tenantId: string,
    userId: string,
    groupId: string,
    optionId: string,
    input: ModifierOptionInput,
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("MODIFIER_GROUPS_FORBIDDEN", "Actor cannot manage extras");
      const result = await client.query(
        `update app.modifier_options set name=$3,price_delta_minor=$4,currency=$5,updated_at=now()
          where id=$1 and modifier_group_id=$2 and status<>'archived' returning id`,
        [optionId, groupId, input.name, input.priceMinor, input.currency],
      );
      if (!result.rows[0]) throw notFound("MODIFIER_OPTION_NOT_FOUND", "Extra option was not found");
      return { updated: true };
    });
  }

  archiveOption(tenantId: string, userId: string, groupId: string, optionId: string) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("MODIFIER_GROUPS_FORBIDDEN", "Actor cannot manage extras");
      const result = await client.query(
        `update app.modifier_options set status='archived',updated_at=now()
          where id=$1 and modifier_group_id=$2 and status<>'archived' returning id`,
        [optionId, groupId],
      );
      if (!result.rows[0]) throw notFound("MODIFIER_OPTION_NOT_FOUND", "Extra option was not found");
      return { archived: true };
    });
  }

  setItemGroups(tenantId: string, userId: string, catalogItemId: string, groupIds: string[]) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("MODIFIER_GROUPS_FORBIDDEN", "Actor cannot manage extras");
      const item = await client.query(
        `select id from app.catalog_items where id=$1 and status<>'archived'`,
        [catalogItemId],
      );
      if (!item.rows[0]) throw notFound("OFFERING_NOT_FOUND", "Offering was not found");
      await client.query(`delete from app.item_modifier_groups where catalog_item_id=$1`, [catalogItemId]);
      for (const [index, groupId] of groupIds.entries()) {
        await client.query(
          `insert into app.item_modifier_groups(id,tenant_id,catalog_item_id,modifier_group_id,required,sort_order)
           values($1,$2,$3,$4,false,$5)`,
          [uuidv7(), tenantId, catalogItemId, groupId, index],
        );
      }
      return { updated: true };
    });
  }

  private async canManage(client: PoolClient, userId: string) {
    const result = await client.query(
      "select app.can_manage_channel_connections($1) allowed",
      [userId],
    );
    return result.rows[0]?.allowed === true;
  }
}
