/** Canonical browser app URLs. Identity and API origins remain independent. */
export const APP_BASE_PATH = '/app/';

export function isDeviceInvitationPath(pathname: string): boolean {
    return pathname.replace(/\/$/, '') === `${APP_BASE_PATH}invites/inviteDevice`;
}
