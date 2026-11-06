import { z } from 'zod';
import type { ParentScope, SearchScope, SuggestionScope } from './filesystem.types.js';

const NAME_MAX_LENGTH = 255;
const LIST_MAX_LIMIT = 500;
const LIST_DEFAULT_LIMIT = 100;
const SEARCH_MAX_LIMIT = 100;
const SEARCH_DEFAULT_LIMIT = 50;
const CURSOR_MAX_LENGTH = 2_048;

const ROOT_SCOPE = 'root';

// The spread [...value] splits a string into whole
// Unicode characters (code points), so counting
// that array gives the real number.
// This matches the behavior of the database,
// which counts characters, not bytes.
const isWithinNameLength = (value: string): boolean =>
  [...value].length <= NAME_MAX_LENGTH;

// \p{Cc} - matches control characters (ie. \n, \t, \0, ...).
// `u`    - flag turns on Unicode mode, which `\p{...}` requires.
const hasNoControlCharacters = (value: string): boolean => 
  !/\p{Cc}/u.test(value);

const searchText = z
  .string()
  .min(1)
  .refine(isWithinNameLength, `must be at most ${NAME_MAX_LENGTH} characters`)
  .refine(hasNoControlCharacters, 'must not contain control characters')
  .refine((value) => value.isWellFormed(), 'must be valid Unicode')
  .transform((value) => value.normalize('NFC'));

const nodeName = searchText
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, 'must not be blank')
  .refine((value) => value !== '.' && value !== '..', 'must not be . or ..')
  .refine((value) => !/[/\\]/.test(value), 'must not contain / or \\');


export const idSchema = z.uuid();

const listCursor = z
  .string()
  .max(CURSOR_MAX_LENGTH)
  .transform((value, ctx) => {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const isCanonical = Buffer.from(decoded, 'utf8').toString('base64url') === value;

    if (!isCanonical || !hasNoControlCharacters(decoded)) {
      ctx.addIssue({ code: 'custom', message: 'invalid cursor' });
      
      // Exit early, value not transformed,
      // but validation failed
      return z.NEVER;
    }

    return decoded;
  });

export const listQuerySchema = z.strictObject({
  parentId: idSchema.nullable().default(null),
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).default(LIST_DEFAULT_LIMIT),
  cursor: listCursor.nullable().default(null),
});
export type ListQuery = z.output<typeof listQuerySchema>;

export const createNodeBodySchema = z.strictObject({
  name: nodeName,
  parentId: idSchema.nullable().default(null),
});

export type CreateNodeBody = z.output<typeof createNodeBodySchema>;

const scopeParentId = z.union([z.literal(ROOT_SCOPE), idSchema]).optional();

const toParentScope = (parentId: string): ParentScope =>
  parentId === ROOT_SCOPE ? { kind: 'root' } : { kind: 'folder', folderId: parentId };

export const searchQuerySchema = z
  .strictObject({
    name: searchText,
    parentId: scopeParentId,
    limit: z.coerce.number().int().min(1).max(SEARCH_MAX_LIMIT).default(SEARCH_DEFAULT_LIMIT),
    cursor: idSchema.optional(),
  })
  .refine(({ parentId, cursor }) => parentId === undefined || cursor === undefined, {
    error: 'cursor only applies when searching all files',
    path: ['cursor'],
    when: ({ issues }) => issues.length === 0,
  })
  .transform(({ name, parentId, limit, cursor }) => {
    const scope: SearchScope =
      parentId === undefined
        ? { kind: 'all', afterId: cursor ?? null }
        : toParentScope(parentId);

    return { name, limit, scope };
  });

export type SearchQuery = z.output<typeof searchQuerySchema>;

export const suggestionsQuerySchema = z
  .strictObject({ prefix: searchText, parentId: scopeParentId })
  .transform(({ prefix, parentId }) => {
    const scope: SuggestionScope =
      parentId === undefined ? { kind: 'all' } : toParentScope(parentId);

    return { prefix, scope };
  });

export type SuggestionsQuery = z.output<typeof suggestionsQuerySchema>;
