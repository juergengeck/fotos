import { describe, expect, it } from 'vitest';
import { copyFilesToDirectory } from './browserIngest';

class MemoryFileHandle {
    readonly kind = 'file';
    content: Blob | string | null = null;

    constructor(readonly name: string) {}

    async createWritable() {
        return {
            write: async (data: Blob | string) => {
                this.content = data;
            },
            close: async () => {},
        };
    }
}

class MemoryDirectoryHandle {
    readonly kind = 'directory';
    readonly directories = new Map<string, MemoryDirectoryHandle>();
    readonly files = new Map<string, MemoryFileHandle>();

    constructor(readonly name: string) {}

    async getDirectoryHandle(
        name: string,
        options: { create?: boolean } = {},
    ): Promise<MemoryDirectoryHandle> {
        const existing = this.directories.get(name);
        if (existing) {
            return existing;
        }

        if (!options.create) {
            throw new Error(`Directory not found: ${name}`);
        }

        const next = new MemoryDirectoryHandle(name);
        this.directories.set(name, next);
        return next;
    }

    async getFileHandle(
        name: string,
        options: { create?: boolean } = {},
    ): Promise<MemoryFileHandle> {
        const existing = this.files.get(name);
        if (existing) {
            return existing;
        }

        if (!options.create) {
            throw new Error(`File not found: ${name}`);
        }

        const next = new MemoryFileHandle(name);
        this.files.set(name, next);
        return next;
    }
}

function imageFile(name: string, webkitRelativePath: string): File {
    const file = new File(['image bytes'], name, { type: 'image/jpeg' });
    Object.defineProperty(file, 'webkitRelativePath', {
        configurable: true,
        value: webkitRelativePath,
    });
    return file;
}

describe('copyFilesToDirectory', () => {
    it('preserves selected directory structure from webkitRelativePath', async () => {
        const root = new MemoryDirectoryHandle('library');
        const copied = await copyFilesToDirectory(root as unknown as FileSystemDirectoryHandle, [
            imageFile('rose.jpg', 'Vacation/Day 1/rose.jpg'),
            imageFile('beach.jpg', 'Vacation/Day 2/beach.jpg'),
        ]);

        expect(copied).toBe(2);
        expect(root.files.size).toBe(0);
        expect(root.directories.get('Vacation')).toBeUndefined();

        const day1 = root.directories.get('Day 1');
        const day2 = root.directories.get('Day 2');
        expect(day1?.files.get('rose.jpg')?.content).toBeInstanceOf(File);
        expect(day2?.files.get('beach.jpg')?.content).toBeInstanceOf(File);
    });
});
