import QRCode from 'qrcode';

const FOTOS_BASE_URL = 'https://fotos.one';

export function faceClusterUrl(clusterId: string): string {
    return `${FOTOS_BASE_URL}/faces/${encodeURIComponent(clusterId)}`;
}

/**
 * Generate a QR code PNG as a Blob for a face cluster.
 */
export async function generateFaceQR(clusterId: string): Promise<Blob> {
    const url = faceClusterUrl(clusterId);
    const dataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        width: 256,
        margin: 1,
        color: {dark: '#000000', light: '#ffffff'}
    });
    const res = await fetch(dataUrl);
    return res.blob();
}
