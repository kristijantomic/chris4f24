export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'NAME_CONFLICT'
  | 'PARENT_NOT_FOUND'
  | 'FOLDER_NOT_FOUND'
  | 'FILE_NOT_FOUND';

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
}

export class ValidationFailedError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
}

export class NameConflictError extends DomainError {
  readonly code = 'NAME_CONFLICT';

  constructor() {
    super('A file or folder with this name already exists here');
  }
}

export class ParentNotFoundError extends DomainError {
  readonly code = 'PARENT_NOT_FOUND';

  constructor() {
    super('Parent folder not found');
  }
}

export class FolderNotFoundError extends DomainError {
  readonly code = 'FOLDER_NOT_FOUND';

  constructor() {
    super('Folder not found');
  }
}

export class FileNotFoundError extends DomainError {
  readonly code = 'FILE_NOT_FOUND';

  constructor() {
    super('File not found');
  }
}
