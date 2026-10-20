import {readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

export async function packWasmFiles(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) await packWasmFiles(file);
        else if (entry.isFile() && file.endsWith('.wasm')) {
            const compressed = gzipSync(await readFile(file), {level: 9});
            if (compressed.length > 25 * 1024 * 1024) throw new Error(`Compressed asset exceeds Cloudflare's file limit: ${file}`);
            await writeFile(`${file}.gz`, compressed);
            await rm(file);
        } else if (entry.isFile() && (await stat(file)).size > 25 * 1024 * 1024) {
            throw new Error(`Asset exceeds Cloudflare's file limit: ${file}`);
        }
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await packWasmFiles(join(dirname(fileURLToPath(import.meta.url)), '_deploy-konrad/konrad'));
}
