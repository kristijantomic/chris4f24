import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  type CreateNodeBody,
  createNodeBodySchema,
  idSchema,
  type ListQuery,
  listQuerySchema,
  type SearchQuery,
  searchQuerySchema,
  type SuggestionsQuery,
  suggestionsQuerySchema,
} from './filesystem.schemas.js';
import { FileSystemService } from './filesystem.service.js';
import type { IFileSystemNode, IPage } from './filesystem.types.js';

const validId = new ZodValidationPipe(idSchema);
const validCreateBody = new ZodValidationPipe(createNodeBodySchema);

@Controller('filesystem')
export class FileSystemController {
  constructor(private readonly nodes: FileSystemService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery): Promise<IPage<IFileSystemNode >> {
    return this.nodes.list(query);
  }

  @Get('search')
  search(
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery,
  ): Promise<IPage<IFileSystemNode>> {
    return this.nodes.searchByName(query);
  }

  @Get('search/suggestions')
  async suggestions(
            @Query(new ZodValidationPipe(suggestionsQuerySchema)) query: SuggestionsQuery,
          ): Promise<{ items: IFileSystemNode[] }> {
            
    return { items: await this.nodes.suggest(query) };
  }

  @Post('folders')
  createFolder(@Body(validCreateBody) body: CreateNodeBody): Promise<IFileSystemNode> {
    return this.nodes.createFolder(body);
  }

  @Delete('folders/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFolder(@Param('id', validId) id: string): Promise<void> {
    return this.nodes.deleteFolder(id);
  }

  @Post('files')
  createFile(@Body(validCreateBody) body: CreateNodeBody): Promise<IFileSystemNode> {
    return this.nodes.createFile(body);
  }

  @Delete('files/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFile(@Param('id', validId) id: string): Promise<void> {
    return this.nodes.deleteFile(id);
  }
}
