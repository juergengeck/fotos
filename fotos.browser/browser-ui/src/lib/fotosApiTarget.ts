export interface FotosApiTargetResolution {
    clientId: string | null;
    explicitClientMissing: boolean;
}

/** Resolve an HTTP bridge request without ever downgrading an explicit target to a fallback client. */
export function resolveFotosApiTarget(params: {
    explicitClientId?: string | null;
    activeClientId: string | null;
    clientIds: readonly string[];
    fallbackClientId: string | null;
}): FotosApiTargetResolution {
    const knownClientIds = new Set(params.clientIds);
    if (params.explicitClientId !== undefined && params.explicitClientId !== null) {
        return knownClientIds.has(params.explicitClientId)
            ? {clientId: params.explicitClientId, explicitClientMissing: false}
            : {clientId: null, explicitClientMissing: true};
    }

    if (params.activeClientId && knownClientIds.has(params.activeClientId)) {
        return {clientId: params.activeClientId, explicitClientMissing: false};
    }

    return {
        clientId: params.fallbackClientId,
        explicitClientMissing: false,
    };
}
