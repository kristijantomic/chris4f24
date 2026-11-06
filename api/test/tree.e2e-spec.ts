import type { NestExpressApplication } from '@nestjs/platform-express';
import { api, clearNodes, createFile, createFolder, createTestApp, UNKNOWN_ID } from './support/test-app.js';

describe('folder and file tree', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearNodes(app));
  afterAll(() => app.close());

  describe('creating', () => {
    it('creates a root folder', async () => {
      const { body } = await api(app).post('/api/filesystem/folders')
                              .send({ name: 'Documents' })
                              .expect(201);

      expect(body.type).toEqual('folder');
    });

    it('creates a file inside a subfolder', async () => {
      const documents = await createFolder(app, 'Documents');
      const reports = await createFolder(app, 'Reports', documents);

      const { body } = await api(app)
        .post('/api/filesystem/files')
        .send({ name: 'q3.pdf', parentId: reports })
        .expect(201);

      expect(body).toMatchObject({ type: 'file', name: 'q3.pdf', parentId: reports });
    });

    it('stores a name as written, whatever SQL it contains', async () => {
      const name = `'; DROP TABLE nodes; --`;
      await createFile(app, name);

      const { body } = await api(app).get('/api/filesystem').expect(200);
      expect(body.items).toEqual([expect.objectContaining({ name })]);
    });

    it('rejects a duplicate name in the same folder', async () => {
      const parent = await createFolder(app, 'Parent');

      await createFile(app, 'a.txt', parent);

      const { body } = await api(app)
        .post('/api/filesystem/files')
        .send({ name: 'a.txt', parentId: parent })
        .expect(409);

      expect(body.error.code).toBe('NAME_CONFLICT');
    });

    it('treats names differing only by case as duplicates', async () => {
      await createFile(app, 'Report.pdf');
      await api(app).post('/api/filesystem/files').send({ name: 'REPORT.PDF' }).expect(409);
    });

    it('does not let a file and a folder share a name', async () => {
      await createFolder(app, 'shared');
      await api(app).post('/api/filesystem/files').send({ name: 'shared' }).expect(409);
    });

    // Following strings look identical but are stored differently.
    // Composed `é` as one character (U+00E9) `C3 A9`
    // Decomposed plain `e` + combining accent (U+0065 U+0301) `65 CC 81`
    // Zod `value.normalize('NFC')` helps me to catch this case.
    it('treats composed and decomposed Unicode as the same name', async () => {
      await createFile(app, 'café.txt');
      await api(app).post('/api/filesystem/files')
              .send({ name: 'café.txt' }).expect(409);
    });

    it('allows the same name in different folders', async () => {
      const first = await createFolder(app, 'first');
      const second = await createFolder(app, 'second');

      await createFile(app, 'a.txt', first);
      await createFile(app, 'a.txt', second);
    });

    it('returns 404 when the parent does not exist', async () => {
      const { body } = await api(app)
        .post('/api/filesystem/folders')
        .send({ name: 'orphan', parentId: UNKNOWN_ID })
        .expect(404);

      expect(body.error.code).toBe('PARENT_NOT_FOUND');
    });

    it('returns 404 when the parent is a file', async () => {
      const file = await createFile(app, 'a.txt');

      const { body } = await api(app)
        .post('/api/filesystem/files')
        .send({ name: 'b.txt', parentId: file })
        .expect(404);

      expect(body.error.code).toBe('PARENT_NOT_FOUND');
    });

    it.each([
      ['empty', ''],
      ['too long', 'a'.repeat(256)],
      ['a dot', '.'],
      ['two dots', '..'],
      ['a slash', 'a/b'],
      ['a backslash', 'a\\b'],
      ['only spaces', '   '],
      ['a dot inside spaces', ' . '],
      ['a NUL byte', 'a\u0000b'],
      ['a control character', 'a\nb'],
      ['a lone surrogate', 'a\ud800b'],
    ])('rejects a name that is %s', async (_label, name) => {
      const { body } = await api(app).post('/api/filesystem/folders')
                              .send({ name })
                              .expect(400);

      expect(body.error.code).toBe('VALIDATION_FAILED');
    });

    it.each([
      ['a leading space', ' a'],
      ['a trailing space', 'a '],
      ['a non-breaking space', 'a '],
    ])('strips %s from the name', async (_label, name) => {
      const { body } = await api(app).post('/api/filesystem/folders')
                              .send({ name })
                              .expect(201);

      expect(body.name).toBe('a');
    });

    it('rejects unknown body fields', async () => {
      await api(app).post('/api/filesystem/folders')
              .send({ name: 'a', type: 'file' })
              .expect(400);
    });

    it('rejects a parentId that is not a UUID', async () => {
      await api(app).post('/api/filesystem/folders')
              .send({ name: 'a', parentId: 'nope' })
              .expect(400);
    });
  });

  describe('listing', () => {
    it('lists only direct children, sorted case-insensitively', async () => {
      const parent = await createFolder(app, 'Parent');
      const child = await createFolder(app, 'banana', parent);
      await createFile(app, 'Cherry.txt', parent);
      await createFile(app, 'apple.txt', parent);
      await createFile(app, 'nested.txt', child);

      const { body } = await api(app).get('/api/filesystem')
                              .query({ parentId: parent })
                              .expect(200);

      expect(body.items.map((node: { name: string }) => node.name)).toEqual([
        'apple.txt',
        'banana',
        'Cherry.txt',
      ]);
      expect(body.nextCursor).toBeNull();
    });

    it('lists the root when parentId is omitted', async () => {
      const parent = await createFolder(app, 'Parent');

      await createFile(app, 'nested.txt', parent);

      const { body } = await api(app).get('/api/filesystem').expect(200);

      expect(body.items.map((node: { id: string }) => node.id)).toEqual([parent]);
    });

    it('walks every row exactly once across pages', async () => {
      const names = ['a', 'b', 'c', 'd', 'e'];
      for (const name of names) await createFile(app, name);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: Record<string, string | number> = { 
          limit: 2,
          ...(cursor ? { cursor } : {})
        };
        const { body } = await api(app).get('/api/filesystem').query(query).expect(200);
       
        seen.push(...body.items.map((node: { name: string }) => node.name));
       
        cursor = body.nextCursor;
      } while (cursor);

      expect(seen).toEqual(names);
    });

    it('does not offer another page when the last page is exactly full', async () => {
      await createFile(app, 'a');
      await createFile(app, 'b');

      const { body } = await api(app).get('/api/filesystem').query({ limit: 2 }).expect(200);

      expect(body.nextCursor).toBeNull();
    });

    it('returns an empty page for an empty folder', async () => {
      const parent = await createFolder(app, 'Empty');

      const { body } = await api(app).get('/api/filesystem')
                              .query({ parentId: parent })
                              .expect(200);
      
      expect(body).toEqual({ items: [], nextCursor: null });
    });

    it('returns 404 for a folder that does not exist', async () => {
      const { body } = await api(app).get('/api/filesystem')
                              .query({ parentId: UNKNOWN_ID })
                              .expect(404);
      
      expect(body.error.code).toBe('FOLDER_NOT_FOUND');
    });

    it('returns 404 when listing a file', async () => {
      const file = await createFile(app, 'a.txt');

      await api(app).get('/api/filesystem').query({ parentId: file }).expect(404);
    });

    it.each([
      ['limit of zero', { limit: 0 }],
      ['limit above the maximum', { limit: 501 }],
      ['limit that is not a number', { limit: 'ten' }],
      ['non-canonical cursor', { cursor: '***' }],
      ['unknown parameter', { sort: 'name' }],
    ])('rejects a %s', async (_label, query) => {
      await api(app).get('/api/filesystem').query(query).expect(400);
    });
  });

  describe('deleting', () => {
    it('deletes a file', async () => {
      const file = await createFile(app, 'a.txt');

      await api(app).delete(`/api/filesystem/files/${file}`).expect(204);
      await api(app).delete(`/api/filesystem/files/${file}`).expect(404);
    });

    it('deletes a folder and everything below it', async () => {
      const top = await createFolder(app, 'top');
      const middle = await createFolder(app, 'middle', top);

      await createFile(app, 'deep.txt', middle);

      const survivor = await createFile(app, 'survivor.txt');

      await api(app).delete(`/api/filesystem/folders/${top}`).expect(204);

      const { body } = await api(app).get('/api/filesystem').expect(200);
      
      expect(body.items.map((node: { id: string }) => node.id)).toEqual([survivor]);
      
      const search = await api(app).get('/api/filesystem/search')
                            .query({ name: 'deep.txt' })
                            .expect(200);
      
      expect(search.body.items).toEqual([]);
    });

    it('frees the name for reuse', async () => {
      const file = await createFile(app, 'a.txt');

      await api(app).delete(`/api/filesystem/files/${file}`).expect(204);
      await createFile(app, 'a.txt');
    });

    it('refuses to delete a file through the folder route', async () => {
      const file = await createFile(app, 'a.txt');
      const { body } = await api(app).delete(`/api/filesystem/folders/${file}`).expect(404);

      expect(body.error.code).toBe('FOLDER_NOT_FOUND');

      await api(app).delete(`/api/filesystem/files/${file}`).expect(204);
    });

    it('refuses to delete a folder through the file route', async () => {
      const folder = await createFolder(app, 'folder');
      const { body } = await api(app).delete(`/api/filesystem/files/${folder}`).expect(404);

      expect(body.error.code).toBe('FILE_NOT_FOUND');
      
      await api(app).delete(`/api/filesystem/folders/${folder}`).expect(204);
    });

    it('rejects an id that is not a UUID', async () => {
      await api(app).delete('/api/filesystem/folders/not-a-uuid').expect(400);
      await api(app).delete('/api/filesystem/files/not-a-uuid').expect(400);
    });
  });
});
