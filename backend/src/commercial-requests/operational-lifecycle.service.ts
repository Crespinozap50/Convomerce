import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class OperationalLifecycleService implements OnApplicationBootstrap,OnModuleDestroy {
  private readonly logger=new Logger(OperationalLifecycleService.name);
  private timer?:NodeJS.Timeout;
  private running=false;
  constructor(private readonly database:DatabaseService){}
  onApplicationBootstrap(){void this.advance();this.timer=setInterval(()=>void this.advance(),30_000);this.timer.unref()}
  private async advance(){if(this.running)return;this.running=true;try{const result=await this.database.withRuntimeTransaction(client=>client.query<{activated:number;started:number;completed:number;expired:number}>(`select * from app.advance_operational_lifecycle()`));const row=result.rows[0];if(row&&Object.values(row).some(Number))this.logger.log({event:'operational_lifecycle_advanced',...row})}catch(error){this.logger.error('Could not advance the operational lifecycle',error)}finally{this.running=false}}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer)}
}
