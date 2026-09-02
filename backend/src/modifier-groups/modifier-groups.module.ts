import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModifierGroupsController } from "./modifier-groups.controller";
import { ModifierGroupsService } from "./modifier-groups.service";

@Module({
  imports: [AuthModule],
  controllers: [ModifierGroupsController],
  providers: [ModifierGroupsService],
})
export class ModifierGroupsModule {}
