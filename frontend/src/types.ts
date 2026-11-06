export type NodeType = 'file' | 'folder';

export interface FsNode {
  id: string;
  parentId: string | null;
  name: string;
  type: NodeType;
  createdAt: string;
}