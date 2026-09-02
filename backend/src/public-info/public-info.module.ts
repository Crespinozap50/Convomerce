import { Module } from '@nestjs/common';
import { PublicInfoController } from './public-info.controller';

@Module({ controllers: [PublicInfoController] })
export class PublicInfoModule {}
