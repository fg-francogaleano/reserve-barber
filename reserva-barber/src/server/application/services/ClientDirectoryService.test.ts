import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientDirectoryService } from './ClientDirectoryService';
import { CLIENTS_PAGE_SIZE, MAX_CLIENTS_PAGE } from '@/server/application/dashboard/clientPageParams';
import type {
  ClientDirectoryPage,
  ClientDirectoryRow,
  IClientDirectoryRepository,
} from '@/server/domain/repositories/IClientDirectoryRepository';

const OWNER = 'own-1';

function client(id: string, confirmed = 1): ClientDirectoryRow {
  return {
    id,
    name: `C${id}`,
    email: `${id}@example.com`,
    phone: '+5491100000000',
    confirmedCount: confirmed,
    inactiveCount: 0,
  };
}

function serviceOver(...pages: ClientDirectoryPage[]) {
  const listForOwner = vi.fn();
  for (const page of pages) listForOwner.mockResolvedValueOnce(page);
  const repository = { listForOwner } as unknown as IClientDirectoryRepository;
  return { service: new ClientDirectoryService(repository), listForOwner };
}

beforeEach(() => vi.clearAllMocks());

describe('ClientDirectoryService - the ordinary page', () => {
  it('should_read_the_first_page_when_nothing_is_requested', async () => {
    const { service, listForOwner } = serviceOver({ rows: [client('a')], total: 1 });

    const view = await service.loadPage({ ownerId: OWNER, rawPage: undefined });

    expect(listForOwner).toHaveBeenCalledWith({
      ownerId: OWNER,
      skip: 0,
      take: CLIENTS_PAGE_SIZE,
    });
    expect(view).toEqual({ rows: [client('a')], page: 1, lastPage: 1, total: 1 });
  });

  it('should_read_the_requested_page_when_it_exists', async () => {
    const { service, listForOwner } = serviceOver({
      rows: [client('b')],
      total: CLIENTS_PAGE_SIZE * 3,
    });

    const view = await service.loadPage({ ownerId: OWNER, rawPage: '3' });

    expect(listForOwner).toHaveBeenCalledWith({
      ownerId: OWNER,
      skip: CLIENTS_PAGE_SIZE * 2,
      take: CLIENTS_PAGE_SIZE,
    });
    expect(view.page).toBe(3);
    expect(view.lastPage).toBe(3);
  });

  it('should_cost_one_read_for_a_page_that_exists', async () => {
    const { service, listForOwner } = serviceOver({ rows: [client('a')], total: 1 });

    await service.loadPage({ ownerId: OWNER, rawPage: '1' });

    expect(listForOwner).toHaveBeenCalledTimes(1);
  });
});

describe('ClientDirectoryService - a page that does not exist', () => {
  it('should_resolve_to_the_last_page_rather_than_an_empty_table', async () => {
    // An empty result on page nine hundred is indistinguishable from a shop
    // with no clients, and those are different facts.
    const { service, listForOwner } = serviceOver(
      { rows: [], total: CLIENTS_PAGE_SIZE * 2 },
      { rows: [client('z')], total: CLIENTS_PAGE_SIZE * 2 }
    );

    const view = await service.loadPage({ ownerId: OWNER, rawPage: '900' });

    expect(view.page).toBe(2);
    expect(view.rows).toEqual([client('z')]);
    expect(listForOwner).toHaveBeenNthCalledWith(2, {
      ownerId: OWNER,
      skip: CLIENTS_PAGE_SIZE,
      take: CLIENTS_PAGE_SIZE,
    });
  });

  it('should_never_ask_the_database_for_an_absurd_offset', async () => {
    // The first clamp does this, before any total is known: the database will
    // honour a large OFFSET by walking and discarding rows.
    const { service, listForOwner } = serviceOver(
      { rows: [], total: 3 },
      { rows: [client('a')], total: 3 }
    );

    await service.loadPage({ ownerId: OWNER, rawPage: '999999999' });

    const firstSkip = (listForOwner.mock.calls[0]![0] as { skip: number }).skip;
    expect(firstSkip).toBe((MAX_CLIENTS_PAGE - 1) * CLIENTS_PAGE_SIZE);
  });

  it('should_resolve_an_empty_shop_to_the_first_page', async () => {
    const { service, listForOwner } = serviceOver(
      { rows: [], total: 0 },
      { rows: [], total: 0 }
    );

    const view = await service.loadPage({ ownerId: OWNER, rawPage: '7' });

    expect(view).toEqual({ rows: [], page: 1, lastPage: 1, total: 0 });
    expect(listForOwner).toHaveBeenNthCalledWith(2, {
      ownerId: OWNER,
      skip: 0,
      take: CLIENTS_PAGE_SIZE,
    });
  });

  it('should_not_re_read_for_an_empty_shop_already_on_the_first_page', async () => {
    const { service, listForOwner } = serviceOver({ rows: [], total: 0 });

    const view = await service.loadPage({ ownerId: OWNER, rawPage: undefined });

    expect(view.rows).toEqual([]);
    expect(listForOwner).toHaveBeenCalledTimes(1);
  });

  it('should_degrade_a_malformed_page_without_a_second_read', async () => {
    const { service, listForOwner } = serviceOver({ rows: [client('a')], total: 1 });

    const view = await service.loadPage({ ownerId: OWNER, rawPage: 'tres' });

    expect(view.page).toBe(1);
    expect(listForOwner).toHaveBeenCalledTimes(1);
  });
});

describe('ClientDirectoryService - scoping', () => {
  it('should_pass_the_session_owner_to_every_read', async () => {
    const { service, listForOwner } = serviceOver(
      { rows: [], total: 10 },
      { rows: [client('a')], total: 10 }
    );

    await service.loadPage({ ownerId: OWNER, rawPage: '900' });

    for (const call of listForOwner.mock.calls) {
      expect((call[0] as { ownerId: string }).ownerId).toBe(OWNER);
    }
  });
});
