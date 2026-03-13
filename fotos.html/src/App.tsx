import { FotosViewer } from '@/components/FotosViewer';
import { useSettings } from '@/hooks/useSettings';
import { useServerAccess } from '@/hooks/useServerAccess';

export function App() {
    const folder = useServerAccess();
    const settingsController = useSettings();
    return (
        <FotosViewer
            source={folder}
            settingsController={settingsController}
            loadingLabel="connecting to server..."
            emptyStateLabel="no photos found on server — tap to ingest"
        />
    );
}
