import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = process.env.ANDROID_HOME || path.join(process.env.HOME, 'Library/Android/sdk');
const adb = process.env.ADB || path.join(sdk, 'platform-tools/adb');
const device = process.argv[2] || process.env.FOTOS_FIRE_DEVICE || '192.168.178.23:5555';
const apk = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
function run(args) {
  const result = spawnSync(adb, args, {stdio: 'inherit', timeout: 120000});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (!existsSync(apk)) throw new Error('Build the APK first with pnpm build:apk');
run(['connect', device]);
run(['-s', device, 'get-state']);
run(['-s', device, 'install', '-r', apk]);
run(['-s', device, 'shell', 'am', 'start', '-W', '-n', 'one.fotos.fire/.MainActivity']);
