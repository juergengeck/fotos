import {beforeEach, describe, expect, it, vi} from 'vitest';
const ports = vi.hoisted(() => ({clear: vi.fn(), logout: vi.fn(), order: [] as string[]}));
vi.mock('react', () => ({useState: (value: unknown) => [value, vi.fn()], useEffect: vi.fn(), useCallback: (fn: unknown) => fn}));
vi.mock('./ModelContext', () => ({useModel: () => ({initialized: true, one: {logout: ports.logout}})}));
vi.mock('../services/glue-login', () => ({clearGlueSession: ports.clear}));
import {useAuth} from './useAuth';
beforeEach(() => {ports.order.length = 0; ports.clear.mockReset(); ports.logout.mockReset();});
describe('explicit Expo logout', () => {
  it('clears the active Glue subject before local logout', async () => {
    ports.clear.mockImplementation(async () => {ports.order.push('clear');});
    ports.logout.mockImplementation(async () => {ports.order.push('logout');});
    await useAuth().logout(); expect(ports.order).toEqual(['clear', 'logout']);
  });
  it('reports a failed session clear without a successful-looking local logout', async () => {
    ports.clear.mockRejectedValue(new Error('SecureStore unavailable'));
    await expect(useAuth().logout()).rejects.toThrow('SecureStore unavailable');
    expect(ports.logout).not.toHaveBeenCalled();
  });
});
