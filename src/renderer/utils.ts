import log from "electron-log";
import { settings } from "../common/settings";
import { BUILDS, FADE_TIME, IMG_URL_PREFIX, RANDOM_BUILD } from "./constants";
import { g } from "./globals";
import { Screen } from "./types/Screen";

export function amSecondTestAccount(): boolean {
  return (
    g.myUsername.startsWith("TestAccount") && g.myUsername !== "TestAccount1"
  );
}

// From: https://stackoverflow.com/questions/27709489/jquery-tooltipster-plugin-hide-all-tips
export function closeAllTooltips(): void {
  const instances = $.tooltipster.instances();
  $.each(instances, (_i, instance) => {
    if (instance.status().open) {
      instance.close();
    }
  });
}

export function errorShow(message: string, customModalName?: string): void {
  // Come back in a second if we are still in a transition.
  if (g.currentScreen === Screen.TRANSITION) {
    setTimeout(() => {
      errorShow(message, customModalName);
    }, FADE_TIME + 5); // 5 milliseconds of leeway
    return;
  }

  // Log the message
  if (message !== "") {
    log.error(message);
  } else if (customModalName === undefined) {
    log.error("Generic error.");
  }

  // Don't do anything if we are already showing an error.
  if (g.currentScreen === Screen.ERROR) {
    return;
  }
  g.currentScreen = Screen.ERROR;

  // Disconnect from the server, if connected.
  if (g.conn !== null) {
    g.conn.close();
  }

  // Hide the links in the header.
  $("#header-profile").fadeOut(FADE_TIME);
  $("#header-leaderboards").fadeOut(FADE_TIME);
  $("#header-help").fadeOut(FADE_TIME);

  // Hide the buttons in the header.
  $("#header-lobby").fadeOut(FADE_TIME);
  $("#header-new-race").fadeOut(FADE_TIME);
  $("#header-settings").fadeOut(FADE_TIME);

  // Close all tooltips.
  closeAllTooltips();

  $("#gui").fadeTo(FADE_TIME, 0.1, () => {
    // Show the modal.
    if (customModalName === undefined) {
      $("#error-modal").fadeIn(FADE_TIME);
      $("#error-modal-description").html(message);
    } else if (customModalName === "isaac-path-modal") {
      $(`#${customModalName}`).fadeIn(FADE_TIME);
    }
  });
}

// From: https://stackoverflow.com/questions/6234773/can-i-escape-html-special-chars-in-javascript
export function escapeHTML(unsafe: string): string {
  return unsafe
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function findAjaxError(jqXHR: JQuery.jqXHR): string {
  if (jqXHR.readyState === 0) {
    return "A network error occurred. The server might be down!";
  }

  if (jqXHR.responseText === "") {
    return "An unknown error occurred.";
  }

  return jqXHR.responseText;
}

// From: https://stackoverflow.com/questions/13627308/add-st-nd-rd-and-th-ordinal-suffix-to-a-number
export function ordinalSuffixOf(i: number): string {
  // Handle French ordinals
  if (settings.get("language") === "fr") {
    return i === 1 ? `${i}er` : `${i}ème`;
  }

  // Default to English
  const j = i % 10;
  const k = i % 100;
  if (j === 1 && k !== 11) {
    return `${i}st`;
  }
  if (j === 2 && k !== 12) {
    return `${i}nd`;
  }
  if (j === 3 && k !== 13) {
    return `${i}rd`;
  }
  return `${i}th`;
}

// From: https://stackoverflow.com/questions/5517597/plain-count-up-timer-in-javascript
export function pad(value: number): string {
  return value > 9 ? value.toString() : `0${value}`;
}

export function setElementBackgroundImage(id: string, url: string): void {
  $(`#${id}`).css("background-image", `url("${url}")`);
}

export function setElementBuildIcon(id: string, buildIndex: number): void {
  let fileNamePrefix: string;
  if (buildIndex === RANDOM_BUILD) {
    fileNamePrefix = "random";
  } else {
    const build = BUILDS[buildIndex];
    if (build === undefined) {
      throw new Error(`Failed to find the build at index: ${buildIndex}`);
    }

    const firstCollectible = build.collectibles[0];
    if (firstCollectible === undefined) {
      throw new Error(
        `Failed to get the first collectible of build: ${build.name}`,
      );
    }

    fileNamePrefix = firstCollectible.id.toString();
  }

  const url = `${IMG_URL_PREFIX}/builds/${fileNamePrefix}.png`;
  setElementBackgroundImage(id, url);
}

export function warningShow(message: string): void {
  // Come back in a second if we are still in a transition.
  if (g.currentScreen === Screen.TRANSITION) {
    setTimeout(() => {
      warningShow(message);
    }, FADE_TIME + 5); // 5 milliseconds of leeway
    return;
  }

  // Log the message
  log.warn(message);

  // Close all tooltips
  closeAllTooltips();

  // Show the warning modal.
  $("#gui").fadeTo(FADE_TIME, 0.1, () => {
    $("#warning-modal").fadeIn(FADE_TIME);
    $("#warning-modal-description").html(message);
  });
}
