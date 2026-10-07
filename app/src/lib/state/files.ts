/**
 * Byte files for the encrypted cache and receipt ciphertext. Android: expo-file-system under the
 * app's documents folder. Web: files.web.ts (localStorage, base64url). Callers only ever pass
 * ciphertext.
 */
import { Directory, File, Paths } from "expo-file-system";

export type Folder = "cache" | "blobs";

function dir(folder: Folder, create: boolean): Directory {
  const d = new Directory(Paths.document, folder);
  if (create && !d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export function fileWrite(folder: Folder, name: string, bytes: Uint8Array): void {
  new File(dir(folder, true), name).write(bytes);
}

export function fileRead(folder: Folder, name: string): Uint8Array | null {
  const f = new File(dir(folder, false), name);
  return f.exists ? f.bytesSync() : null;
}

export function fileDelete(folder: Folder, name: string): void {
  const f = new File(dir(folder, false), name);
  if (f.exists) f.delete();
}

export function folderClear(folder: Folder): void {
  const d = new Directory(Paths.document, folder);
  if (d.exists) d.delete();
}
