import {
  createNodeBodySchema,
  listQuerySchema,
  searchQuerySchema,
  suggestionsQuerySchema,
} from './filesystem.schemas.js';

const ID = '019a0000-0000-7000-8000-000000000001';

describe('createNodeBodySchema', () => {
  it('defaults parentId to the root', () => {
    expect(createNodeBodySchema.parse({ name: 'a' })).toEqual({ name: 'a', parentId: null });
  });

  it('normalises names to NFC', () => {
    expect(createNodeBodySchema.parse({ name: 'café' }).name).toBe('café');
  });

  it('counts emoji as one character each, as Postgres does', () => {
    expect(createNodeBodySchema.safeParse({ name: '\u{1F600}'.repeat(255) }).success).toBe(true);
    expect(createNodeBodySchema.safeParse({ name: '\u{1F600}'.repeat(256) }).success).toBe(false);
  });

  it.each(['a b', '...', '.hidden', 'a.b.c', 'name with é', '100%_done'])('accepts %s', (name) => {
    expect(createNodeBodySchema.safeParse({ name }).success).toBe(true);
  });
});

describe('listQuerySchema', () => {
  it('applies defaults', () => {
    expect(listQuerySchema.parse({})).toEqual({ parentId: null, limit: 100, cursor: null });
  });

  it('decodes a cursor', () => {
    const cursor = Buffer.from('café', 'utf8').toString('base64url');
    expect(listQuerySchema.parse({ cursor }).cursor).toBe('café');
  });

  it.each([
    ['base64 that is not canonical', 'YWJj='],
    ['bytes that are not UTF-8', Buffer.from([0xff, 0xfe]).toString('base64url')],
    ['a control character', Buffer.from('a\u0000', 'utf8').toString('base64url')],
    ['an oversized value', 'a'.repeat(2_049)],
  ])('rejects a cursor holding %s', (_label, cursor) => {
    expect(listQuerySchema.safeParse({ cursor }).success).toBe(false);
  });
});

describe('searchQuerySchema', () => {
  it('searches all files when parentId is omitted', () => {
    expect(searchQuerySchema.parse({ name: 'a', cursor: ID }).scope).toEqual({
      kind: 'all',
      afterId: ID,
    });
  });

  it('maps parentId=root to the root scope', () => {
    expect(searchQuerySchema.parse({ name: 'a', parentId: 'root' }).scope).toEqual({ kind: 'root' });
  });

  it('maps a UUID parentId to a folder scope', () => {
    expect(searchQuerySchema.parse({ name: 'a', parentId: ID }).scope).toEqual({
      kind: 'folder',
      folderId: ID,
    });
  });

  it('reports a bad cursor without masking other errors', () => {
    const result = searchQuerySchema.safeParse({ name: '', parentId: 'root', cursor: ID });

    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['name']);
  });
});

describe('suggestionsQuerySchema', () => {
  it('suggests from all files when parentId is omitted', () => {
    expect(suggestionsQuerySchema.parse({ prefix: 'a' }).scope).toEqual({ kind: 'all' });
  });

  it('maps parentId=root to the root scope', () => {
    expect(suggestionsQuerySchema.parse({ prefix: 'a', parentId: 'root' }).scope).toEqual({
      kind: 'root',
    });
  });

  it('maps a UUID parentId to a folder scope', () => {
    expect(suggestionsQuerySchema.parse({ prefix: 'a', parentId: ID }).scope).toEqual({
      kind: 'folder',
      folderId: ID,
    });
  });

  it('rejects a parentId that is neither root nor a UUID', () => {
    expect(suggestionsQuerySchema.safeParse({ prefix: 'a', parentId: 'nope' }).success).toBe(false);
  });
});
