import type { NestExpressApplication } from '@nestjs/platform-express';
import { api, clearNodes, createFile, createFolder, createTestApp, UNKNOWN_ID } from './support/test-app.js';

const SEARCH = '/api/filesystem/search';
const SUGGESTIONS = '/api/filesystem/search/suggestions';

const names = (body: { items: { name: string }[] }): string[] =>
  body.items.map((node) => node.name);

describe('search', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearNodes(app));
  afterAll(() => app.close());

  describe('exact name', () => {
    it('finds every file with the name across all folders', async () => {
      const first = await createFolder(app, 'first');
      const second = await createFolder(app, 'second');
      const ids = [
        await createFile(app, 'a.txt', first),
        await createFile(app, 'a.txt', second)
      ];
     
      await createFile(app, 'b.txt', first);

      const { body } = await api(app).get(SEARCH).query({ name: 'a.txt' }).expect(200);

      expect(body.items.map((node: { id: string }) => node.id).sort()).toEqual(ids.sort());
    });

    it('matches exactly, not by prefix or case', async () => {
      await createFile(app, 'Report.pdf');

      for (const name of ['report.pdf', 'Report', 'Report.pdf.bak']) {
        const { body } = await api(app).get(SEARCH).query({ name }).expect(200);
        expect(body.items).toEqual([]);
      }
    });

    it('matches case exactly within a folder and at root level', async () => {
      const parent = await createFolder(app, 'parent');

      await createFile(app, 'Report.pdf', parent);
      await createFile(app, 'Notes.txt');

      const inFolder = await api(app)
        .get(SEARCH)
        .query({ name: 'report.pdf', parentId: parent })
        .expect(200);
      expect(inFolder.body.items).toEqual([]);

      const atRoot = await api(app)
        .get(SEARCH)
        .query({ name: 'notes.txt', parentId: 'root' })
        .expect(200);
      expect(atRoot.body.items).toEqual([]);
    });

    it('never returns folders', async () => {
      await createFolder(app, 'name');

      const { body } = await api(app).get(SEARCH).query({ name: 'name' }).expect(200);

      expect(body.items).toEqual([]);
    });

    it('finds Unicode names however the search text is composed', async () => {
      await createFile(app, 'café.txt');

      const { body } = await api(app).get(SEARCH).query({ name: 'café.txt' }).expect(200);

      expect(body.items).toHaveLength(1);
    });

    it('pages through all files by cursor', async () => {
      for (const folderName of ['one', 'two', 'three']) {
        await createFile(app, 'same.txt', await createFolder(app, folderName));
      }

      const first = await api(app).get(SEARCH).query({ name: 'same.txt', limit: 2 }).expect(200);

      expect(first.body.items).toHaveLength(2);

      const second = await api(app)
        .get(SEARCH)
        .query({ name: 'same.txt', limit: 2, cursor: first.body.nextCursor })
        .expect(200);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();

      const ids = [...first.body.items, ...second.body.items].map((node) => node.id);

      expect(new Set(ids).size).toBe(3);
    });

    it('searches direct children of a folder only', async () => {
      const parent = await createFolder(app, 'parent');
      const child = await createFolder(app, 'child', parent);

      await createFile(app, 'nested.txt', child);

      const direct = await createFile(app, 'direct.txt', parent);

      const found = await api(app)
        .get(SEARCH)
        .query({ name: 'direct.txt', parentId: parent })
        .expect(200);
      expect(found.body.items.map((node: { id: string }) => node.id)).toEqual([direct]);

      const nested = await api(app)
        .get(SEARCH)
        .query({ name: 'nested.txt', parentId: parent })
        .expect(200);
      expect(nested.body.items).toEqual([]);
    });

    it('limits the search to root level with parentId=root', async () => {
      await createFile(app, 'a.txt', await createFolder(app, 'folder'));

      const none = await api(app).get(SEARCH)
                          .query({ name: 'a.txt', parentId: 'root' })
                          .expect(200);
      
      expect(none.body.items).toEqual([]);

      const root = await createFile(app, 'a.txt');
      const one = await api(app).get(SEARCH)
                          .query({ name: 'a.txt', parentId: 'root' })
                          .expect(200);
      
      expect(one.body.items.map((node: { id: string }) => node.id)).toEqual([root]);
    });

    it('returns 404 when the folder does not exist', async () => {
      const { body } = await api(app)
        .get(SEARCH)
        .query({ name: 'a.txt', parentId: UNKNOWN_ID })
        .expect(404);

      expect(body.error.code).toBe('FOLDER_NOT_FOUND');
    });

    it.each([
      ['a missing name', {}],
      ['an empty name', { name: '' }],
      ['a name that is too long', { name: 'a'.repeat(256) }],
      ['a NUL byte', { name: 'a\u0000' }],
      ['an invalid parentId', { name: 'a', parentId: 'nope' }],
      ['an invalid cursor', { name: 'a', cursor: 'nope' }],
      ['a limit above the maximum', { name: 'a', limit: 101 }],
      ['a cursor within a folder', { name: 'a', parentId: 'root', cursor: UNKNOWN_ID }],
    ])('rejects %s', async (_label, query) => {
      await api(app).get(SEARCH).query(query).expect(400);
    });
  });

  describe('suggestions', () => {
    it('returns at most 10 files, sorted', async () => {
      for (const letter of 'lkjihgfedcba') await createFile(app, `report-${letter}.pdf`);

      const { body } = await api(app).get(SUGGESTIONS).query({ prefix: 'report' }).expect(200);

      expect(names(body)).toEqual([...'abcdefghij'].map((letter) => `report-${letter}.pdf`));
    });

    it('matches the start of the name, not the middle', async () => {
      await createFile(app, 'report.pdf');
      await createFile(app, 'my-report.pdf');

      const { body } = await api(app).get(SUGGESTIONS).query({ prefix: 'rep' }).expect(200);

      expect(names(body)).toEqual(['report.pdf']);
    });

    it('ignores case', async () => {
      await createFile(app, 'REPORT.pdf');

      const { body } = await api(app).get(SUGGESTIONS).query({ prefix: 'rep' }).expect(200);

      expect(names(body)).toEqual(['REPORT.pdf']);
    });

    it('ignores case for non-ASCII letters', async () => {
      await createFile(app, 'Članak.pdf');

      const { body } = await api(app).get(SUGGESTIONS).query({ prefix: 'član' }).expect(200);

      expect(names(body)).toEqual(['Članak.pdf']);
    });

    it('searches every folder and skips folders themselves', async () => {
      await createFile(app, 'report.pdf', await createFolder(app, 'report-folder'));

      const { body } = await api(app).get(SUGGESTIONS).query({ prefix: 'rep' }).expect(200);

      expect(names(body)).toEqual(['report.pdf']);
    });

    it('limits suggestions to root files when asked', async () => {
      await createFile(app, 'report-root.pdf');
      await createFile(app, 'report-nested.pdf', await createFolder(app, 'folder'));

      const { body } = await api(app).get(SUGGESTIONS)
                              .query({ prefix: 'rep', parentId: 'root' })
                              .expect(200);
      
      expect(names(body)).toEqual(['report-root.pdf']);
    });

    it('limits suggestions to one folder when asked', async () => {
      const folder = await createFolder(app, 'folder');
      await createFile(app, 'report-root.pdf');
      await createFile(app, 'report-other.pdf', await createFolder(app, 'other'));
      await createFile(app, 'report-nested.pdf', folder);

      const { body } = await api(app).get(SUGGESTIONS)
                              .query({ prefix: 'rep', parentId: folder })
                              .expect(200);
      
      expect(names(body)).toEqual(['report-nested.pdf']);
    });

    it('answers 404 for suggestions in an unknown folder', async () => {
      await api(app).get(SUGGESTIONS)
                    .query({ prefix: 'rep', parentId: UNKNOWN_ID })
                    .expect(404);
    });

    it.each([
      ['%', 'anything.txt'],
      ['_', 'anything.txt'],
      ['a%', 'abc.txt'],
      ['a_c', 'abc.txt'],
    ])('treats the wildcard in %s as a literal character', async (prefix, name) => {
      await createFile(app, name);

      const { body } = await api(app).get(SUGGESTIONS)
                              .query({ prefix })
                              .expect(200);
      expect(body.items).toEqual([]);
    });

    it('finds names that really contain wildcard characters', async () => {
      await createFile(app, '100%_done.txt');

      const { body } = await api(app).get(SUGGESTIONS)
                              .query({ prefix: '100%_' })
                              .expect(200);
      expect(names(body)).toEqual(['100%_done.txt']);
    });

    it('treats a backslash as a literal character', async () => {
      await createFile(app, 'abc.txt');

      const { body } = await api(app).get(SUGGESTIONS)
                              .query({ prefix: 'a\\' })
                              .expect(200);
      expect(body.items).toEqual([]);
    });

    it('rejects an empty prefix and unknown parameters', async () => {
      await api(app).get(SUGGESTIONS)
                    .query({ prefix: '' })
                    .expect(400);
      await api(app).get(SUGGESTIONS)
                    .query({ prefix: 'a', limit: 5 })
                    .expect(400);
    });
  });
});
