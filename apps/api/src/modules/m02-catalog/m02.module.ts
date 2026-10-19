import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CodesController } from './codes.controller';

@Module({ controllers: [CatalogController, CodesController] })
export class M02Module {}
