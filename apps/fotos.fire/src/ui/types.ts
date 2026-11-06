export interface FirePhoto {
  id: string;
  name: string;
  thumbnailUri?: string;
  mediaUri?: string;
  mimeType?: string;
  takenAt?: string;
}

export interface FireTvAppProps {
  status: 'starting' | 'ready' | 'error';
  error?: string;
  photos: FirePhoto[];
  deviceName: string;
  pairingUrl?: string;
  pairingBusy: boolean;
  pairingError?: string;
  onPair: () => void;
  onClosePairing: () => void;
  onRetry: () => void;
}
