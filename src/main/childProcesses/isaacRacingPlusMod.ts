import type { ReadonlyRecord } from "isaacscript-common-ts";
import klawSync from "klaw-sync";
import path from "node:path";
import { deleteFile, fileExists, getFileHash, isDir } from "../../common/file";

// This is the name of the folder for the Racing+ Lua mod after it is downloaded through Steam.
const STEAM_WORKSHOP_MOD_NAME = "racing+_857628390";
const SHA1_HASHES_URL =
  "https://raw.githubusercontent.com/Zamiell/racing-plus/main/sha1.json";

export function exists(modsPath: string): boolean {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  const racingPlusModPath = path.join(modsPath, STEAM_WORKSHOP_MOD_NAME);
  if (fileExists(racingPlusModPath) && isDir(racingPlusModPath)) {
    return true;
  }

  process.send(`Failed to find the Racing+ mod at: ${racingPlusModPath}`);
  return false;
}

export async function isValid(modsPath: string): Promise<boolean> {
  const racingPlusModPath = path.join(modsPath, STEAM_WORKSHOP_MOD_NAME);
  const checksums = await getModChecksums();

  if (checkCorruptOrMissingFiles(racingPlusModPath, checksums)) {
    return false;
  }

  if (checkExtraneousFiles(racingPlusModPath, checksums)) {
    return false;
  }

  return true;
}

async function getModChecksums(): Promise<Record<string, string>> {
  const response = await fetch(SHA1_HASHES_URL);
  const checksums = (await response.json()) as Record<string, string>;

  return checksums;
}

function checkCorruptOrMissingFiles(
  modPath: string,
  checksums: ReadonlyRecord<string, string>,
): boolean {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  let modIsCorrupt = false;

  // Each key of the JSON is the relative path to the file.
  for (const [relativePath, backupFileHash] of Object.entries(checksums)) {
    const filePath = path.join(modPath, relativePath);

    if (fileExists(filePath)) {
      // Make an exception for the "sha1.json" file. (This will not have a valid checksum.)
      if (path.basename(filePath) === "sha1.json") {
        continue;
      }

      // Make an exception for the "metadata.xml" file. (This file may have changed because it
      // changes after uploading the mod to the workshop.)
      if (path.basename(filePath) === "metadata.xml") {
        continue;
      }

      const fileHash = getFileHash(filePath);
      if (fileHash !== backupFileHash) {
        process.send(`File is corrupt: ${filePath}`);
        process.send(
          `The hash of "${fileHash}" does not match the hash of "${backupFileHash}" for the file of "${filePath}" (when comparing using the "sha1.json" file from "${SHA1_HASHES_URL}").`,
        );
        modIsCorrupt = true;
      }
    } else {
      process.send(`File is missing: ${filePath}`);
      modIsCorrupt = true;
    }
  }

  return modIsCorrupt;
}

function checkExtraneousFiles(
  modPath: string,
  checksums: ReadonlyRecord<string, string>,
): boolean {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  // To be thorough, also go through the mod directory and check to see if there are any extraneous
  // files that are not on the hash list.
  let modFiles: readonly klawSync.Item[];
  try {
    modFiles = klawSync(modPath);
  } catch (error) {
    throw new Error(
      `Failed to enumerate the files in the "${modPath}" directory: ${error}`,
    );
  }

  let hasExtraneousFiles = false;

  for (const klawSyncItem of modFiles) {
    // Get the relative path by chopping off the left side. We add one to remove the trailing slash.
    const modFile = klawSyncItem.path.slice(Math.max(0, modPath.length + 1));

    if (!klawSyncItem.stats.isFile()) {
      // Ignore directories; even extraneous directories shouldn't cause any harm.
      continue;
    } else if (
      // This file may not match the one distributed through Steam.
      path.basename(modFile) === "metadata.xml" ||
      path.basename(modFile) === "disable.it" // They might have the mod disabled
    ) {
      continue;
    }

    // Delete all files that are not found within the JSON hashes.
    if (!Object.keys(checksums).includes(modFile)) {
      const filePath = path.join(modPath, modFile);
      process.send(`Extraneous file found: ${filePath}`);
      hasExtraneousFiles = true;
      deleteFile(filePath);
    }
  }

  return hasExtraneousFiles;
}
