export type NodeType = 'folder' | 'file';

export interface IFileSystemNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  createdAt: Date;
}

export interface IPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type ParentScope = { kind: 'root' } | { kind: 'folder'; folderId: string };

export type SearchScope = { kind: 'all'; afterId: string | null } | ParentScope;

export type SuggestionScope = { kind: 'all' } | ParentScope;
