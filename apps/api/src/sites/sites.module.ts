import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SiteFeatureEntity } from './site-feature.entity';
import { SiteEntity } from './site.entity';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';

@Module({
  imports: [TypeOrmModule.forFeature([SiteEntity, SiteFeatureEntity])],
  controllers: [SitesController],
  providers: [SitesService],
})
export class SitesModule {}
