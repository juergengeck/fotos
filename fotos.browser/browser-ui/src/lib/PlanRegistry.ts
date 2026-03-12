/**
 * Lightweight PlanRegistry for fotos.browser.
 * Same interface as refinio.api PlanRegistry but self-contained (no cross-package import).
 */

interface CallResult<T = any> {
    success: boolean;
    data?: T;
    error?: { code: string; message: string };
}

export class PlanRegistry {
    private plans = new Map<string, any>();

    register(name: string, instance: any, _options?: {category?: string; description?: string}): void {
        this.plans.set(name, instance);
        const methods = this.getMethods(instance);
        console.log(`[PlanRegistry] Registered plan: ${name} (${methods.length} methods)`);
    }

    async call<T = any>(planName: string, methodName: string, params?: any): Promise<CallResult<T>> {
        try {
            const plan = this.plans.get(planName);
            if (!plan) return { success: false, error: { code: 'PLAN_NOT_FOUND', message: `Plan '${planName}' not found` } };

            const method = plan[methodName];
            if (typeof method !== 'function') return { success: false, error: { code: 'METHOD_NOT_FOUND', message: `Method '${methodName}' not found on '${planName}'` } };

            const result = Array.isArray(params)
                ? await method.apply(plan, params)
                : await method.call(plan, params);

            if (result && typeof result === 'object' && 'success' in result) return result;
            return { success: true, data: result };
        } catch (error) {
            return { success: false, error: { code: 'EXECUTION_ERROR', message: error instanceof Error ? error.message : String(error) } };
        }
    }

    listPlans(): string[] {
        return Array.from(this.plans.keys());
    }

    private getMethods(plan: any): string[] {
        const methods = new Set<string>();
        for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(plan))) {
            if (name !== 'constructor' && !name.startsWith('_') && typeof plan[name] === 'function') methods.add(name);
        }
        return Array.from(methods);
    }
}

export function createPlanRegistry(): PlanRegistry {
    return new PlanRegistry();
}
