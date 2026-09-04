import { mkdir, readdir, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const utilsDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(utilsDir, "..");

export const streamStorageRoot = resolve(apiRoot, "storage", "streams");

function normalizeStoragePath(pathValue) {
  return resolve(String(pathValue || ""));
}

export function isInsideStreamStorage(pathValue) {
  const resolvedPath = normalizeStoragePath(pathValue);
  const storageRelativePath = relative(streamStorageRoot, resolvedPath);
  return Boolean(storageRelativePath) && !storageRelativePath.startsWith("..") && !isAbsolute(storageRelativePath);
}

function safeResolveStreamPath(...parts) {
  const resolvedPath = resolve(streamStorageRoot, ...parts.map((part) => String(part)));
  if (!isInsideStreamStorage(resolvedPath)) {
    throw new Error("Ruta de grabacion fuera del storage permitido");
  }
  return resolvedPath;
}

export async function ensureStreamStorageDir(...parts) {
  const dir = safeResolveStreamPath(...parts);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function resolveStreamRecordingPath(...parts) {
  return safeResolveStreamPath(...parts);
}

export async function deleteRecordingFiles(paths = []) {
  const uniquePaths = [
    ...new Set(
      paths
        .filter(Boolean)
        .map(normalizeStoragePath)
        .filter(isInsideStreamStorage)
    )
  ];
  const result = {
    requested: paths.length,
    deleted: 0,
    missing: 0,
    skipped: paths.length - uniquePaths.length,
    errors: []
  };

  for (const storagePath of uniquePaths) {
    try {
      await unlink(storagePath);
      result.deleted += 1;
    } catch (err) {
      if (err?.code === "ENOENT") {
        result.missing += 1;
      } else {
        result.errors.push({ path: storagePath, message: err.message });
      }
    }
  }

  return result;
}

export async function deleteOperationStreamFiles(idOperacion) {
  const id = Number(idOperacion);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("id_operacion invalido para limpiar grabaciones");
  }

  const opDir = safeResolveStreamPath(`op_${id}`);
  await rm(opDir, { recursive: true, force: true });
  return { path: opDir };
}

async function listFilesRecursive(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = resolve(dir, entry.name);
    if (!isInsideStreamStorage(entryPath)) continue;
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

export async function deleteOrphanStreamFiles(validStoragePaths = []) {
  const validPaths = new Set(
    validStoragePaths
      .filter(Boolean)
      .map(normalizeStoragePath)
      .filter(isInsideStreamStorage)
  );
  const existingFiles = await listFilesRecursive(streamStorageRoot);
  const orphanFiles = existingFiles.filter((filePath) => !validPaths.has(normalizeStoragePath(filePath)));
  return deleteRecordingFiles(orphanFiles);
}
