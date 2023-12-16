/* eslint-disable import/first */

// When the Racing+ client starts, we need to perform several checks:

// 1) Racing+ mod integrity

// After the mod is updated on the Steam Workshop, the game can fail to download it and/or integrate
// it, which seems to happen pretty commonly. We computed the SHA1 hash of every file during the
// build process and wrote it to "sha1.json". Compare all files in the mod directory to this JSON.

// 2) "--luadebug" launch options for the game in Steam

// This is required for the Racing+ mod to talk to the Racing+ client. However, it cannot be set
// until Steam is completely closed (because it caches the value in memory).

// 3) Sandbox Lua files in place

// Since we are turning on --luadebug, we provide a sandbox so that only certain functions can be
// called.

// First, initialize the error logging, because importing can cause errors. (This is why we have to
// disable "import/first" above.)

import { childError, processExit, handleErrors } from "./subroutines";
// organize-imports-ignore
handleErrors();

import { execSync } from "node:child_process";
import path from "node:path";
import ps from "ps-node";
import type { RegistryItem } from "winreg";
import Registry from "winreg";
import { isSandboxValid } from "./isaacIsSandboxValid";
import {
  hasLaunchOption,
  LAUNCH_OPTION,
  setLaunchOption,
} from "./isaacLaunchOptions";
import * as isaacRacingPlusMod from "./isaacRacingPlusMod";
import { fileExists, isDir, isFile } from "../../common/file";
import { parseIntSafe } from "isaacscript-common-ts";

const ISAAC_PROCESS_NAME = "isaac-ng.exe";
const STEAM_PROCESS_NAME = "steam.exe";

let steamPath: string;
let steamActiveUserID: number;
let gamePath: string;
let shouldRestartIsaac = false;
let shouldRestartSteam = false;

init();

function init() {
  process.on("message", onMessage);
  getSteamPath();
}

function onMessage(message: string) {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  // The child will stay alive even if the parent has closed, so we depend on the parent telling us
  // when to die.
  if (message === "exit") {
    process.exit();
  }

  // Otherwise, we expect a message from the parent process telling us what the path to the Isaac
  // executable is.
  const isaacPath = message;
  if (typeof isaacPath !== "string") {
    process.send(
      "error: The message received for the isaacPath was not a string.",
      processExit,
    );
    return;
  }
  process.send(`Using an Isaac path of: ${isaacPath}`);

  if (!fileExists(isaacPath) || !isFile(isaacPath)) {
    process.send("isaacNotFound", processExit);
    return;
  }

  gamePath = path.dirname(isaacPath);
  process.send(`Using a game path of: ${gamePath}`);

  // Begin the process of getting the necessary information from the registry.
  getSteamPath();
}

function getSteamPath() {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  process.send("Checking for the Steam path...");

  // Get the path of where the user has Steam installed to We can find this in the Windows registry.
  const steamKey = new Registry({
    hive: Registry.HKCU,
    key: "\\Software\\Valve\\Steam",
  });

  steamKey.get("SteamPath", postGetSteamPath);
}

function postGetSteamPath(err: Error | undefined | null, item: RegistryItem) {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  if (err !== undefined && err !== null) {
    throw new Error(
      `Failed to read the Windows registry when trying to figure out what the Steam path is: ${err.message}`,
    );
  }

  steamPath = item.value.trim();
  if (steamPath === "") {
    throw new Error(
      "The Windows registry has a blank Steam path. Is Steam running and are you properly logged in? If so, try restarting your computer.",
    );
  }
  process.send(`Steam path found: ${steamPath}`);

  getSteamActiveUser();
}

function getSteamActiveUser() {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  process.send("Checking for the Steam active user...");

  // Get the Steam ID of the active user We can also find this in the Windows registry.
  const steamKey = new Registry({
    hive: Registry.HKCU,
    key: "\\Software\\Valve\\Steam\\ActiveProcess",
  });
  steamKey.get("ActiveUser", postGetSteamActiveUser);
}

function postGetSteamActiveUser(
  err: Error | undefined | null,
  item: RegistryItem,
) {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  if (err !== undefined && err !== null) {
    throw new Error(
      `Failed to read the Windows registry when trying to figure out what the active Steam user is: ${err.message}`,
    );
  }

  const steamActiveUserIDString = item.value.trim();
  if (steamPath === "") {
    throw new Error(
      "The Windows registry has a blank Steam active user ID. Is Steam running and are you properly logged in? If so, try restarting your computer.",
    );
  }

  // The active user is stored in the registry as a hexadecimal value, so we have to convert it to
  // base 10. (We can't use `parseIntSafe` because we need to use a radix of 16.)
  steamActiveUserID = Number.parseInt(steamActiveUserIDString, 16);
  if (Number.isNaN(steamActiveUserID) || steamActiveUserID < 0) {
    throw new TypeError(
      `Failed to parse the Steam ID from the Windows registry: ${steamActiveUserIDString}`,
    );
  }

  if (steamActiveUserID === 0) {
    throw new Error(
      "You do not appear to be logged into Steam. (Your Steam user active ID is 0 in the Windows registry.) Is Steam running and are you properly logged in? If so, try restarting your computer.",
    );
  }

  process.send(`Steam active user found: ${steamActiveUserID}`);

  checkModExists();
}

function checkModExists() {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  const modsPath = path.join(gamePath, "mods");
  if (!fileExists(modsPath) || !isDir(modsPath)) {
    throw new Error(`Failed to find the "mods" directory at: ${modsPath}`);
  }

  const modExists = isaacRacingPlusMod.exists(modsPath);
  if (!modExists) {
    // The mod not being found is an ordinary error. The end-user probably has not yet subscribed to
    // the mod on the Steam Workshop.
    process.send("modNotFound", processExit);
    return;
  }

  checkModIntegrity(modsPath).catch(childError);
}

async function checkModIntegrity(modsPath: string) {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  process.send("Checking to see if the Racing+ mod is corrupted...");

  // Mod checks are performed in a separate file.
  const modValid = await isaacRacingPlusMod.isValid(modsPath);
  if (modValid) {
    process.send("The mod perfectly matched!");
  } else {
    process.send("modCorrupt", processExit);
    return;
  }

  checkLaunchOption();
}

function checkLaunchOption() {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  process.send(`Checking for the "${LAUNCH_OPTION}" launch option...`);

  // Launch option checking is performed in a separate file.
  const launchOptionSet = hasLaunchOption(steamPath, steamActiveUserID);
  if (launchOptionSet) {
    process.send("The launch option is already set.");
  } else {
    process.send("The launch option is not set.");
    shouldRestartIsaac = true;
    shouldRestartSteam = true;
  }

  checkLuaSandbox();
}

function checkLuaSandbox() {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  process.send("Checking to see if the Lua sandbox is in place...");

  // Sandbox checks are performed in a separate file.
  const sandboxValid = isSandboxValid(gamePath);
  if (sandboxValid) {
    process.send("The sandbox is in place.");
  } else {
    process.send("The sandbox was corrupted or missing.");
    shouldRestartIsaac = true;
  }

  checkCloseIsaac();
}

function checkCloseIsaac() {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  if (!shouldRestartIsaac) {
    process.send(
      "File system validation passed. (No changes needed to be made.)",
    );
    process.send("isaacChecksComplete", processExit);
    return;
  }

  const [isaacOpen, isaacPID] = isProcessRunning(ISAAC_PROCESS_NAME);
  if (isaacOpen) {
    closeIsaac(isaacPID);
  } else if (shouldRestartSteam) {
    checkCloseSteam();
  } else {
    // Don't automatically open Isaac for them, since that might be annoying.
    process.send("File system repair complete. (Isaac was not open.)");
    process.send("isaacChecksComplete", processExit);
  }
}

function closeIsaac(pid: number) {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  process.send("Closing Isaac...");
  ps.kill(pid, postKillIsaac);
}

function postKillIsaac(err?: Error) {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  if (err !== undefined) {
    throw new Error(`Failed to close Isaac: ${err.message}`);
  }

  process.send("Closed Isaac.");

  if (shouldRestartSteam) {
    checkCloseSteam();
    return;
  }

  // After a short delay, start Isaac again.
  setTimeout(() => {
    startIsaac();
  }, 1000); // 1 second
}

function checkCloseSteam() {
  const [steamOpen, steamPID] = isProcessRunning(STEAM_PROCESS_NAME);
  if (steamOpen) {
    closeSteam(steamPID);
  } else {
    postKillSteam();
  }
}

function closeSteam(pid: number) {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  process.send("Closing Steam...");
  ps.kill(pid, postKillSteam);
}

function postKillSteam() {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  setLaunchOption(steamPath, steamActiveUserID);
  process.send(`Set the launch option of "${LAUNCH_OPTION}".`);

  // We don't have to manually start Steam, because we can instead just launch Isaac, which will in
  // turn automatically start Steam for us.
  startIsaac();
}

function startIsaac() {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  // We have to start Isaac from the main process because we don't have access to "electron.shell"
  // from here.
  process.send("startIsaac");
  process.send("isaacChecksComplete", processExit);
}

function isProcessRunning(processName: string): [boolean, number] {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  // The "tasklist" module has problems on different languages. The "ps-node" module is very slow.
  // The "process-list" module will not compile for some reason. So, just manually run the
  // "tasklist" command and parse the output without using any module.
  const command = "tasklist";
  let output: string[];
  try {
    output = execSync(command).toString().split("\r\n");
  } catch (error) {
    throw new Error(`Failed to execute the "${command}" command: ${error}`);
  }

  for (const line of output) {
    if (!line.startsWith(`${processName} `)) {
      continue;
    }

    const lineWithoutPrefix = line.slice(processName.length + 1);

    const match = lineWithoutPrefix.match(/^\s*(\d+) /);
    if (match === null) {
      throw new Error(
        `Failed to parse the output of the "${command}" command.`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const pidString = match[1]!;
    const pid = parseIntSafe(pidString);
    if (pid === undefined) {
      throw new Error(
        `Failed to convert "${pid}" to a number from the "${command}" command.`,
      );
    }

    return [true, pid];
  }

  return [false, -1];
}
