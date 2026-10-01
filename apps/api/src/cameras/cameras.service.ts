import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { CameraSource } from '@occ/camera-adapter';
import type { Camera, StreamDescriptor } from '@occ/contracts';
import { Repository } from 'typeorm';
import { EntityNotFoundError } from '../common/domain-errors';
import { CameraEntity } from './camera.entity';
import { CAMERA_SOURCE } from './camera-source.provider';

@Injectable()
export class CamerasService {
  constructor(
    @InjectRepository(CameraEntity) private readonly cameras: Repository<CameraEntity>,
    @Inject(CAMERA_SOURCE) private readonly source: CameraSource,
  ) {}

  async list(zoneId?: string): Promise<Camera[]> {
    const cameras = await this.cameras.find({
      where: zoneId ? { zoneId } : {},
      order: { code: 'ASC' },
    });
    return cameras.map((camera) => camera.toContract());
  }

  async resolveStream(id: string): Promise<StreamDescriptor> {
    const camera = await this.cameras.findOneBy({ id });
    if (!camera) throw new EntityNotFoundError('Camera', id);
    return this.source.resolveStream(camera.toRef());
  }
}
