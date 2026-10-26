import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = process.env.ANDROID_HOME || path.join(process.env.HOME, 'Library/Android/sdk');
const java = process.env.JAVA_HOME || spawnSync('/usr/libexec/java_home', ['-v', '17'], {encoding: 'utf8'}).stdout?.trim();
const env = {...process.env, ANDROID_HOME: sdk, JAVA_HOME: java, EXPO_TV: '1', NODE_ENV: 'production'};
function run(cmd, args, cwd = root) {
  const result = spawnSync(cmd, args, {cwd, env, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run('pnpm', ['exec', 'expo', 'prebuild', '--platform', 'android', '--no-install']);
run('./gradlew', [':app:assembleRelease', '--console=plain', '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m', '-PreactNativeArchitectures=armeabi-v7a'], path.join(root, 'android'));
console.log('APK: ' + path.join(root, 'android/app/build/outputs/apk/release/app-release.apk'));
