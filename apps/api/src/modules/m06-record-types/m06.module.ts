import { Module } from '@nestjs/common';
import { RecordTypesController } from './record-types.controller';

@Module({ controllers: [RecordTypesController] })
export class M06Module {}
