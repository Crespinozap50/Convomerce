import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LoggroApiClient } from "./loggro-api-client.service";
import { LoggroConnectionController } from "./loggro-connection.controller";
import { LoggroConnectionService } from "./loggro-connection.service";
import { LoggroOrderSyncService } from "./loggro-order-sync.service";

@Module({
  imports: [AuthModule],
  controllers: [LoggroConnectionController],
  providers: [LoggroApiClient, LoggroConnectionService, LoggroOrderSyncService],
  exports: [LoggroOrderSyncService],
})
export class PosIntegrationsModule {}
