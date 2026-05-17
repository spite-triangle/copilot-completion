import * as fs from 'node:fs/promises';
import path from 'node:path';

let _wasmDirPath: string | undefined;

/** Set the WASM directory path. Called from extension activate() with context.extensionUri.fsPath. */
export function setWasmDirPath(extensionFsPath: string): void {
    _wasmDirPath = path.resolve(extensionFsPath, 'dist', 'wasm');
}

export function locateFile(filename: string): string {
    if (_wasmDirPath) {
        return path.resolve(_wasmDirPath, filename);
    }
    // Fallback: resolve relative to __dirname (webpack bundle in dist/)
    return path.resolve(__dirname, 'wasm', filename);
}

export async function readFile(filename: string): Promise<Uint8Array> {
    return await fs.readFile(locateFile(filename));
}
