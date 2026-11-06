import { Inject, Injectable } from '@nestjs/common';
import { DatabaseError, Pool } from 'pg';
import {
  NameConflictError,
  ParentNotFoundError,
  ValidationFailedError,
} from '../common/domain-errors.js';
import { PG_POOL } from '../database/database.module.js';
import type { IFileSystemNode, NodeType, IPage, SuggestionScope } from './filesystem.types.js';

const SUGGESTIONS_LIMIT = 10;

const NODE_COLUMNS = `
  id,
  type,
  name,
  parent_id AS "parentId",
  created_at AS "createdAt"
`;

const listChildrenSql = (parentFilter: string): string => `
  SELECT
    ${NODE_COLUMNS},
    lower(name) AS "sortKey"
  FROM nodes
  WHERE ${parentFilter}
    AND ($2::text IS NULL OR lower(name) > $2)
  ORDER BY parent_id, lower(name)
  LIMIT $1`;

const LIST_ROOT_CHILDREN = listChildrenSql('parent_id IS NULL');
const LIST_FOLDER_CHILDREN = listChildrenSql('parent_id = $3');

const FOLDER_EXISTS = `
  SELECT 1
  FROM nodes
  WHERE id = $1
    AND type = 'folder';
`;

const INSERT_NODE = `
  INSERT INTO nodes (type, name, parent_id)
  VALUES ($1, $2, $3)
  RETURNING ${NODE_COLUMNS};
`;

const DELETE_NODE = `
  DELETE FROM nodes
  WHERE id = $1
    AND type = $2;
`;

const FIND_FILES_BY_NAME = `
  SELECT ${NODE_COLUMNS}
  FROM nodes
  WHERE type = 'file'
    AND name = $1
    AND ($3::uuid IS NULL OR id > $3)
  ORDER BY id
  LIMIT $2;
`;

const findFileInParentSql = (parentFilter: string): string => `
  SELECT ${NODE_COLUMNS}
  FROM nodes
  WHERE type = 'file' AND ${parentFilter}
    AND lower(name) = lower($1)
    AND name = $1;
`;

const FIND_FILE_IN_ROOT = findFileInParentSql('parent_id IS NULL');
const FIND_FILE_IN_FOLDER = findFileInParentSql('parent_id = $2');

const suggestFilesSql = (parentFilter: string): string => `
  SELECT ${NODE_COLUMNS}
  FROM nodes
  WHERE type = 'file' ${parentFilter}
    AND lower(name) COLLATE "C" LIKE lower($1) || '%'
  ORDER BY lower(name) COLLATE "C", id
  LIMIT ${SUGGESTIONS_LIMIT};
`;

const SUGGEST_ALL_FILES = suggestFilesSql('');
const SUGGEST_FILES_IN_ROOT = suggestFilesSql('AND parent_id IS NULL');
const SUGGEST_FILES_IN_FOLDER = suggestFilesSql('AND parent_id = $2');

const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, '\\$&');

const encodeCursor = (sortKey: string): string =>
  Buffer.from(sortKey, 'utf8').toString('base64url');

function translateWriteError(error: unknown): unknown {
  if (!(error instanceof DatabaseError)) return error;

  switch (error.constraint) {
    case 'nodes_unique_name_per_parent':
      return new NameConflictError();
    case 'nodes_parent_fk':
      return new ParentNotFoundError();
    case 'nodes_name_valid':
      return new ValidationFailedError('name: not a valid file or folder name');
    default:
      return error;
  }
}

@Injectable()
export class FileSystemRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async listChildren(
    parentId: string | null,
    limit: number,
    afterSortKey: string | null,
  ): Promise<IPage<IFileSystemNode>> {
    // Give me one extra row to determine
    // if there is a next page
    const pageSize = limit + 1;
    const { rows } =
      parentId === null
        ? await this.pool.query<IFileSystemNode & { sortKey: string }>(
            LIST_ROOT_CHILDREN,
            [pageSize,  afterSortKey]
          )
        : await this.pool.query<IFileSystemNode & { sortKey: string }>(
            LIST_FOLDER_CHILDREN,
            [pageSize, afterSortKey, parentId]
          );

    const pageRows = rows.slice(0, limit);
    const lastRow = pageRows.at(-1);

    return {
      items: pageRows.map(({ sortKey: _sortKey, ...node }) => node),
      nextCursor: rows.length > limit && lastRow 
        ? encodeCursor(lastRow.sortKey) 
        : null,
    };
  }

  async folderExists(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(FOLDER_EXISTS, [id]);
    return rowCount === 1;
  }

  async create(type: NodeType, name: string, parentId: string | null): Promise<IFileSystemNode> {
    try {
      const { rows } = await this.pool.query<IFileSystemNode>(
        INSERT_NODE,
        [type, name, parentId]
      );
      
      return rows[0];
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async delete(id: string, type: NodeType): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      DELETE_NODE,
      [id, type]
    );

    return rowCount === 1;
  }

  async findFilesByName(
    name: string,
    limit: number,
    afterId: string | null,
  ): Promise<IPage<IFileSystemNode>> {
    const { rows } = await this.pool.query<IFileSystemNode>(
      FIND_FILES_BY_NAME,
      [name, limit + 1, afterId]
    );

    const items = rows.slice(0, limit);
    const lastItem = items.at(-1);

    return {
      items,
      nextCursor: rows.length > limit && lastItem ? lastItem.id : null 
    };
  }

  async findFileInParent(name: string, parentId: string | null): Promise<IFileSystemNode | null> {
    const { rows } =
      parentId === null
        ? await this.pool.query<IFileSystemNode>(FIND_FILE_IN_ROOT, [name])
        : await this.pool.query<IFileSystemNode>(FIND_FILE_IN_FOLDER, [name, parentId]);

    return rows[0] ?? null;
  }

  async suggestFiles(prefix: string, scope: SuggestionScope): Promise<IFileSystemNode[]> {
    const pattern = escapeLikePattern(prefix);
    const { rows } =
      scope.kind === 'folder'
        ? await this.pool.query<IFileSystemNode>(SUGGEST_FILES_IN_FOLDER, [pattern, scope.folderId])
        : await this.pool.query<IFileSystemNode>(
            scope.kind === 'root' ? SUGGEST_FILES_IN_ROOT : SUGGEST_ALL_FILES,
            [pattern],
          );

    return rows;
  }
}
