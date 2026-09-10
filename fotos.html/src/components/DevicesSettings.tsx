import { DevicesManager } from '@vger/vger.ui/components/device/DevicesManager';
import type { DevicesPlan } from '@refinio/ui.core/types/devices';
import { invoke } from '../api/client';

async function call<T>(method: string, params?: unknown): Promise<T> {
  const result = await invoke(`devices:${method}`, params);
  if (!result.success) throw new Error(typeof result.error === 'string' ? result.error : 'Device operation failed');
  return result.data as T;
}
const devices: DevicesPlan = {
  listDevices: () => call('listDevices'),
  renameDevice: params => call('renameDevice', params),
  removeDevice: params => call('removeDevice', params),
};
const pairing = {
  createPairingInvitation: (params: { mode: 'IoM' }) => invoke('connections:createPairingInvitation', params),
  acceptPairingInvitation: (params: { invitationUrl: string }) => invoke('connections:acceptPairingInvitation', params),
};
export function DevicesSettings() {
  return <details><summary>Devices</summary><DevicesManager devices={devices} pairing={pairing} /></details>;
}
