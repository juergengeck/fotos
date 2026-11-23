import { CoreModule } from '@vger/vger.core/modules/CoreModule.js';
import { ChatModule } from '@vger/vger.core/modules/ChatModule.js';
import { TrustModule } from '@vger/vger.core/modules/TrustModule.js';
import { ConnectionModule } from '@vger/vger.core/modules/ConnectionModule.js';
import { DeviceModule } from '@vger/vger.core/modules/DeviceModule.js';
import { InstanceModule } from '@vger/vger.core/modules/InstanceModule.js';
import { JournalModule } from '@vger/vger.core/modules/JournalModule.js';
import { IssuerKeyLifecycleModule } from '@refinio/trust.core/modules/IssuerKeyLifecycleModule.js';
import { InstanceAuthorityModule } from '@refinio/trust.core/modules/InstanceAuthorityModule.js';
import { PersonalTrustModule } from '@refinio/trust.me/modules/PersonalTrustModule.js';

export function createFotosRuntimeModules(commServerUrl: string, webUrl: string) {
    const connection = new ConnectionModule(commServerUrl, webUrl);
    // Pairing and group sync require chat protocol plans and signed Assemblies.
    const modules = [new CoreModule(commServerUrl), new TrustModule(),
        new IssuerKeyLifecycleModule(), new InstanceAuthorityModule(), new PersonalTrustModule(),
        new JournalModule(), new ChatModule(), connection, new DeviceModule(), new InstanceModule()];
    return {modules, connection};
}
