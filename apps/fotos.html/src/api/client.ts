/**
 * HTTP client for fotos.html → lama.headless communication.
 * Same invoke pattern as lama.html/src/api/client.ts.
 */

export async function invoke(channel: string, params: any = {}): Promise<any> {
    try {
        const response = await fetch('/api/invoke', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            credentials: 'include',
            body: JSON.stringify({channel, params}),
        });
        if (!response.ok) {
            return {success: false, error: `HTTP ${response.status}`};
        }
        return response.json();
    } catch (error) {
        return {success: false, error: (error as Error).message};
    }
}
