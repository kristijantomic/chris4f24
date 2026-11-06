import { Injectable } from '@nestjs/common';
import { FileNotFoundError, FolderNotFoundError } from '../common/domain-errors.js';
import { FileSystemRepository } from './filesystem.repository.js';
import type { CreateNodeBody, ListQuery, SearchQuery, SuggestionsQuery } from './filesystem.schemas.js';
import type { IFileSystemNode, NodeType, IPage } from './filesystem.types.js';

@Injectable()
export class FileSystemService {
  constructor(private readonly repository: FileSystemRepository) {}

  async list({ parentId, limit, cursor }: ListQuery): Promise<IPage<IFileSystemNode>> {
    const page = await this.repository.listChildren(parentId, limit, cursor);

    if (page.items.length === 0 && parentId !== null)
      await this.assertFolderExists(parentId);

    return page;
  }

  createFolder(body: CreateNodeBody): Promise<IFileSystemNode> {
    return this.create('folder', body);
  }

  createFile(body: CreateNodeBody): Promise<IFileSystemNode> {
    return this.create('file', body);
  }

  async deleteFolder(id: string): Promise<void> {
    if (!(await this.repository.delete(id, 'folder')))
      throw new FolderNotFoundError();
  }

  async deleteFile(id: string): Promise<void> {
    if (!(await this.repository.delete(id, 'file')))
      throw new FileNotFoundError();
  }

  async searchByName({ name, limit, scope }: SearchQuery): Promise<IPage<IFileSystemNode>> {
    if (scope.kind === 'all')
      return this.repository.findFilesByName(name, limit, scope.afterId);

    const parentId = scope.kind === 'folder' ? scope.folderId : null;
    const match = await this.repository.findFileInParent(name, parentId);

    if (match === null && parentId !== null)
      await this.assertFolderExists(parentId);

    return { items: match ? [match] : [], nextCursor: null };
  }

  async suggest({ prefix, scope }: SuggestionsQuery): Promise<IFileSystemNode[]> {
    const files = await this.repository.suggestFiles(prefix, scope);

    if (files.length === 0 && scope.kind === 'folder')
      await this.assertFolderExists(scope.folderId);

    return files;
  }

  private create(type: NodeType, { name, parentId }: CreateNodeBody): Promise<IFileSystemNode> {
    return this.repository.create(type, name, parentId);
  }

  private async assertFolderExists(id: string): Promise<void> {
    if (!(await this.repository.folderExists(id)))
      throw new FolderNotFoundError();
  }
}
