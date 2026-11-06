import { Module } from '@nestjs/common';
import { FileSystemController } from './filesystem.controller.js';
import { FileSystemRepository } from './filesystem.repository.js';
import { FileSystemService } from './filesystem.service.js';

@Module({
  controllers: [FileSystemController],
  providers: [FileSystemService, FileSystemRepository],
})
export class FileSystemModule {}
