import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetEntity } from './asset.entity';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { TelemetryRuleEntity } from './telemetry-rule.entity';

// The class and the points load through `AssetEntity`'s relations, and all four entities are in
// `typeorm-options.ts`, so only the two the service injects are registered here.
@Module({
  imports: [TypeOrmModule.forFeature([AssetEntity, TelemetryRuleEntity])],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
