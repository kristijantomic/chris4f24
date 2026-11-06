import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { clearNodes, createFile, createTestApp, poolOf } from './support/test-app.js';

// These bypass the API on purpose: the rules must hold even for code that skips
// its validation, such as a future import job or a bug.
describe('database invariants', () => {
  let app: NestExpressApplication;
  let pool: Pool;

  beforeAll(async () => {
    app = await createTestApp();
    pool = poolOf(app);
  });
  beforeEach(() => clearNodes(app));
  afterAll(() => app.close());

  const insert = (type: string, name: string, parentId: string | null = null) =>
    pool.query('INSERT INTO nodes (type, name, parent_id) VALUES ($1, $2, $3)', [type, name, parentId]);

  it('stops a file from being a parent', async () => {
    const file = await createFile(app, 'a.txt');

    await expect(insert('file', 'b.txt', file)).rejects.toMatchObject({
      constraint: 'nodes_parent_fk',
    });
  });

  it('stops a row from claiming a file as its parent type', async () => {
    await expect(
      pool.query(`
        INSERT INTO nodes (type, name, parent_type)
        VALUES ('file', 'a', 'file')`),
    ).rejects.toMatchObject({ constraint: 'nodes_parent_is_folder' });
  });

  it('enforces unique names at root level, where parent_id is NULL', async () => {
    await insert('file', 'a.txt');

    await expect(insert('folder', 'A.TXT')).rejects.toMatchObject({
      constraint: 'nodes_unique_name_per_parent',
    });
  });

  it.each([
    ['empty', ''],
    ['a dot', '.'],
    ['two dots', '..'],
    ['a slash', 'a/b'],
    ['a backslash', 'a\\b'],
    ['a leading space', ' a'],
    ['a trailing space', 'a '],
    ['a control character', 'a\nb'],
    ['decomposed Unicode', 'café'],
  ])('rejects a name that is %s', async (_label, name) => {
    await expect(insert('file', name))
            .rejects
            .toMatchObject({ constraint: 'nodes_name_valid' });
  });

  it('limits the API role to reading, adding and deleting rows', async () => {
    await expect(pool.query(`UPDATE nodes SET name = 'x'`))
            .rejects.toMatchObject({ code: '42501' });
    
    await expect(pool.query('TRUNCATE nodes'))
            .rejects.toMatchObject({ code: '42501' });
    
    await expect(pool.query('DROP TABLE nodes'))
            .rejects.toMatchObject({ code: '42501' });
  });
});
