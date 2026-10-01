import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CameraEntity } from './camera.entity';
import { cameraSourceProvider } from './camera-source.provider';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';

@Module({
  imports: [TypeOrmModule.forFeature([CameraEntity])],
  controllers: [CamerasController],
  providers: [CamerasService, cameraSourceProvider],
})
export class CamerasModule {}
