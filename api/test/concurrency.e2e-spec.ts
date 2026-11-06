import type { NestExpressApplication } from '@nestjs/platform-express';
import { api, clearNodes, createFile, createFolder, createTestApp, poolOf } from './support/test-app.js';

const ATTEMPTS = 20;

describe('concurrent writes', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearNodes(app));
  afterAll(() => app.close());

  const statusesOf = async (requests: PromiseLike<{ status: number }>[]): Promise<number[]> =>
    (await Promise.all(requests)).map((response) => response.status);

  it('lets exactly one of many identical creates win', async () => {
    const statuses = await statusesOf(
      Array.from({ length: ATTEMPTS }, () =>
        api(app).post('/api/filesystem/folders').send({ name: 'race' })),
    );

    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(ATTEMPTS - 1);
  });

  it('applies the same rule between a file and a folder at root level', async () => {
    const statuses = await statusesOf(
      Array.from({ length: ATTEMPTS }, (_, i) =>
        api(app)
          .post(i % 2 === 0 ? '/api/filesystem/folders' : '/api/filesystem/files')
          .send({ name: 'race' }),
      ),
    );

    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
  });

  it('never leaves an orphan when creating inside a folder being deleted', async () => {
    const folder = await createFolder(app, 'doomed');

    const creates = Array.from({ length: ATTEMPTS }, (_, i) =>
      api(app)
          .post('/api/filesystem/files')
          .send({ name: `file-${i}`, parentId: folder }),
    );
    const statuses = await statusesOf([
      ...creates,
      api(app).delete(`/api/filesystem/folders/${folder}`),
    ]);

    expect(statuses.pop()).toBe(204);
    expect(statuses.every((status) => status === 201 || status === 404)).toBe(true);

    // count(*)::int - pg driver turns bigint values to strings
    const { rows } = await poolOf(app).query(
      'SELECT count(*)::int AS orphans FROM nodes WHERE parent_id IS NOT NULL',
    );
    expect(rows[0].orphans).toBe(0);
  });

  it('deletes only once when a delete is repeated concurrently', async () => {
    const file = await createFile(app, 'once.txt');

    const statuses = await statusesOf(
      Array.from({ length: ATTEMPTS }, () =>
        api(app).delete(`/api/filesystem/files/${file}`)),
    );

    expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    expect(statuses.filter((status) => status === 404)).toHaveLength(ATTEMPTS - 1);
  });
});
