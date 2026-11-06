declare module 'react-native-zeroconf' {
    import { EventEmitter } from 'events';

    interface ZeroconfService {
        name: string;
        fullName: string;
        host: string;
        addresses: string[];
        port: number;
        txt: Record<string, string>;
    }

    class Zeroconf extends EventEmitter {
        constructor();

        /** Start scanning for services */
        scan(type?: string, protocol?: string, domain?: string): void;

        /** Stop scanning */
        stop(): void;

        /** Publish a service on the local network */
        publishService(
            type: string,
            protocol: string,
            domain: string,
            name: string,
            port: number,
            txt?: Record<string, string>
        ): void;

        /** Unpublish a service */
        unpublishService(name: string): void;

        /** Get all currently known services */
        getServices(): Record<string, ZeroconfService>;

        /** Remove native device event listeners */
        removeDeviceListeners(): void;

        /** Add native device event listeners */
        addDeviceListeners(): void;

        // Event overloads
        on(event: 'start', listener: () => void): this;
        on(event: 'stop', listener: () => void): this;
        on(event: 'error', listener: (error: Error) => void): this;
        on(event: 'found', listener: (name: string) => void): this;
        on(event: 'resolved', listener: (service: ZeroconfService) => void): this;
        on(event: 'remove', listener: (name: string) => void): this;
        on(event: 'update', listener: () => void): this;
        on(event: 'published', listener: (service: ZeroconfService) => void): this;
        on(event: 'unpublished', listener: (service: ZeroconfService) => void): this;
    }

    export default Zeroconf;
    export { ZeroconfService };
}
