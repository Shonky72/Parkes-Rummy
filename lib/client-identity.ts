/** A nonsecret identity pin. Authentication always belongs to the server cookie. */
export interface ClientIdentity {
  readonly accountId: string | null;
  readonly key: string;
  readonly epoch: number;
  readonly ready: boolean;
}

export function createClientIdentityGuard() {
  let identity: ClientIdentity = Object.freeze({ accountId: null, key: 'guest', epoch: 0, ready: true });
  const listeners = new Set<() => void>();
  return {
    get: () => identity,
    current: (captured: ClientIdentity) => captured === identity && identity.ready,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    change(accountId: string | null, ready = true): ClientIdentity {
      if (identity.accountId === accountId && identity.ready === ready) return identity;
      identity = Object.freeze({ accountId, key: ready ? accountId ? `account:${accountId}` : 'guest' : 'checking', epoch: identity.epoch + 1, ready });
      // Listeners abort requests synchronously, before the next screen renders.
      for (const listener of [...listeners]) listener();
      return identity;
    },
  };
}

const guard = createClientIdentityGuard();
export const getClientIdentity = guard.get;
export const isClientIdentityCurrent = guard.current;
export const subscribeClientIdentity = guard.subscribe;
export const setClientIdentity = guard.change;

export function safeAccountReturnPath(value: string): string {
  // OAuth callbacks never accept a caller-supplied host, query or fragment.
  return /^\/join\/[A-Z0-9]{4}(?:[A-Z0-9]{2})?$/.test(value) ? value : '/';
}
