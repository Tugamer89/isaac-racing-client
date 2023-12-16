import * as electron from "electron";
import log from "electron-log";
import { parseIntSafe } from "isaacscript-common-ts";
import linkifyHtml from "linkify-html";
import { FADE_TIME, IS_DEV } from "./constants";
import { debugFunction } from "./debugFunction";
import { g } from "./globals";
import { Screen } from "./types/Screen";
import { errorShow, escapeHTML, warningShow } from "./utils";

const CHAT_INDENT_SIZE = "3.2em";

export function send(destination: string, originalMessage: string): void {
  // Don't do anything if we are not on the screen corresponding to the chat input form.
  if (destination === "lobby" && g.currentScreen !== Screen.LOBBY) {
    return;
  }
  if (destination === "race" && g.currentScreen !== Screen.RACE) {
    return;
  }

  let message = originalMessage.trim();

  // Do nothing if the input field is empty.
  if (message === "") {
    return;
  }

  // If this is a command.
  let isCommand = false;
  let isPM = false;
  let chatArg1: string | undefined;
  let chatArg2: string | undefined;
  if (message.startsWith("/")) {
    isCommand = true;

    // First, for any formatted command, validate that it is formatted correctly.
    if (
      /^\/p\b/.exec(message) !== null ||
      /^\/pm\b/.exec(message) !== null ||
      /^\/m\b/.exec(message) !== null ||
      /^\/msg\b/.exec(message) !== null ||
      /^\/w\b/.exec(message) !== null ||
      /^\/whisper\b/.exec(message) !== null ||
      /^\/t\b/.exec(message) !== null ||
      /^\/tell\b/.exec(message) !== null
    ) {
      isPM = true;

      // Validate that private messages have a recipient.
      const m = /^\/\w+ (.+?) (.+)/.exec(message);
      if (m !== null && m[1] !== undefined && m[2] !== undefined) {
        chatArg1 = m[1]; // recipient
        chatArg2 = m[2]; // message
      } else {
        warningShow(
          '<span lang="en">The format of a private message is</span>: <code>/pm Alice hello</code>',
        );
        return;
      }

      // Get the current list of connected users.
      const userList: string[] = [];
      const roomLobby = g.roomList.get("lobby");
      if (roomLobby === undefined) {
        throw new Error("Failed to get the lobby room.");
      }
      for (const user of roomLobby.users.keys()) {
        userList.push(user);
      }

      // Validate that the recipient is online.
      let isConnected = false;
      for (const user of userList) {
        if (chatArg1.toLowerCase() === user.toLowerCase()) {
          isConnected = true;
          chatArg1 = user;
        }
      }
      if (!isConnected) {
        warningShow("That user is not currently online.");
        return;
      }
    } else if (/^\/notice\b/.exec(message) !== null) {
      // Validate that there is an attached message.
      const m = /^\/\w+ (.+)/.exec(message);
      if (m === null) {
        warningShow(
          '<span lang="en">The format of a notice is</span>: <code>/notice Hey guys!</code>',
        );
        return;
      }
      [, chatArg1] = m;
    } else if (/^\/ban\b/.exec(message) !== null) {
      // Validate that ban commands have a recipient and a reason.
      const m = /^\/ban (.+?) (.+)/.exec(message);
      if (m === null) {
        warningShow(
          '<span lang="en">The format of a ban is</span>: <code>/ban Krak being too Polish</code>',
        );
        return;
      }
      [, chatArg1, chatArg2] = m; // recipient, reason
    } else if (/^\/unban\b/.exec(message) !== null) {
      // Validate that unban commands have a recipient.
      const m = /^\/unban (.+)/.exec(message);
      if (m === null) {
        warningShow(
          '<span lang="en">The format of an unban is</span>: <code>/unban Krak</code>',
        );
        return;
      }
      [, chatArg1] = m;
    } else if (/^\/r\b/.exec(message) !== null) {
      // Check if the user is replying to a message.
      isPM = true;

      // Validate that a PM has been received already.
      if (g.lastPM === null) {
        warningShow("No PMs have been received yet.");
        return;
      }

      const m = /^\/r (.+)/.exec(message);
      if (m === null) {
        warningShow("The format of a reply is: <code>/r [message]</code>");
        return;
      }
      chatArg1 = g.lastPM;
      [, chatArg2] = m;
    } else if (/^\/floor\b/.exec(message) !== null) {
      // Validate that unban commands have a recipient.
      const m = /^\/floor (\d+) (\d+)/.exec(message);
      if (m === null) {
        warningShow(
          '<span lang="en">The format of a floor command is</span>: <code>/floor [stage] [stageType]</code>',
        );
        return;
      }
      [, chatArg1, chatArg2] = m; // stage, stage type
    }
  }

  // Erase the contents of the input field.
  $(`#${destination}-chat-box-input`).val("");

  // Truncate messages longer than 150 characters (this is also enforced server-side).
  if (message.length > 150) {
    message = message.slice(0, 150);
  }

  // Get the room
  let room: string;
  if (destination === "lobby") {
    room = "lobby";
  } else if (destination === "race") {
    room = `_race_${g.currentRaceID}`;
  } else {
    throw new Error("Failed to parse the destination.");
  }

  if (g.conn === null) {
    throw new Error("The WebSocket connection was null.");
  }

  const storedRoom = g.roomList.get(room);
  if (storedRoom === undefined) {
    return;
  }

  // Add it to the history so that we can use up arrow later.
  storedRoom.typedHistory.unshift(message);

  // Reset the history index.
  storedRoom.historyIndex = -1;

  if (!isCommand) {
    // If this is a normal chat message.
    g.conn.send("roomMessage", {
      room,
      message,
    });
  } else if (isPM) {
    if (chatArg1 === undefined) {
      throw new Error("Failed to parse chatArg1.");
    }

    if (chatArg2 === undefined) {
      throw new Error("Failed to parse chatArg2.");
    }

    // If this is a PM (which has many aliases).
    g.conn.send("privateMessage", {
      name: chatArg1,
      message: chatArg2,
    });

    // We won't get a message back from the server if the sending of the PM was successful, so
    // manually call the draw function now.
    draw("PM-to", chatArg1, chatArg2);
  } else if (message === "/debug") {
    draw(
      room,
      "_error",
      'Use "/debug1" for a client debug and "/debug2" for a server debug.',
    );
  } else if (message === "/debug1") {
    // /debug1 - Debug command for the client.
    debugFunction();
  } else if (message.startsWith("/debug2")) {
    // /debug2 - Debug command for the server.
    const m = /^\/\w+ (.+)/.exec(message);
    if (m !== null) {
      [, chatArg1] = m;
    }
    log.info("Sending debug command.");
    g.conn.send("debug", {
      name: chatArg1,
    });
  } else {
    switch (message) {
      case "/restart": {
        // /restart - Restart the client.
        electron.ipcRenderer.send("asynchronous-message", "restart");

        break;
      }

      case "/finish": {
        // /finish - Debug finish.
        if (IS_DEV) {
          g.conn.send("raceFinish", {
            id: g.currentRaceID,
          });
        }

        break;
      }

      case "/ready": {
        if (IS_DEV) {
          g.conn.send("raceReady", {
            id: g.currentRaceID,
          });
        }

        break;
      }

      case "/unready": {
        if (IS_DEV) {
          g.conn.send("raceUnready", {
            id: g.currentRaceID,
          });
        }

        break;
      }

      case "/shutdown": {
        // We want to automatically restart the server by default.
        g.conn.send("adminShutdown", {
          comment: "restart",
        });

        break;
      }

      case "/shutdown2": {
        // This will not automatically restart the server.
        g.conn.send("adminShutdown", {});

        break;
      }

      case "/unshutdown": {
        g.conn.send("adminUnshutdown", {});

        break;
      }

      default: {
        if (message.startsWith("/notice ")) {
          g.conn.send("adminMessage", {
            message: chatArg1,
          });
        } else if (message.startsWith("/ban ")) {
          g.conn.send("adminBan", {
            name: chatArg1,
            comment: chatArg2,
          });
        } else if (message.startsWith("/unban ")) {
          g.conn.send("adminUnban", {
            name: chatArg1,
          });
        } else if (message.startsWith("/floor ")) {
          if (chatArg1 === undefined) {
            throw new Error("Failed to parse chatArg1.");
          }

          if (chatArg2 === undefined) {
            throw new Error("Failed to parse chatArg2.");
          }

          g.conn.send("raceFloor", {
            id: g.currentRaceID,
            floorNum: parseIntSafe(chatArg1),
            stageType: parseIntSafe(chatArg2),
          });
        } else if (message.startsWith("/checkpoint")) {
          g.conn.send("raceItem", {
            id: g.currentRaceID,
            itemID: 560,
          });
        } else if (message.startsWith("/rankedsoloreset")) {
          g.conn.send("rankedSoloReset");
        } else {
          draw(room, "_error", "That is not a valid command.");
        }

        break;
      }
    }
  }
}

export function draw(
  room: string,
  name: string,
  message: string,
  datetime: number | null = null,
  discord = false,
): void {
  // Check for errors
  let error = false;
  if (name === "_error") {
    error = true;
  }

  // Check for the existence of a PM.
  let privateMessage: string | null = null;
  if (room === "PM-to") {
    privateMessage = "to";
  } else if (room === "PM-from") {
    privateMessage = "from";
    g.lastPM = name;
  }
  if (room === "PM-to" || room === "PM-from") {
    if (g.currentScreen === Screen.LOBBY) {
      room = "lobby"; // eslint-disable-line no-param-reassign
    } else if (g.currentScreen === Screen.RACE) {
      room = `_race_${g.currentRaceID}`; // eslint-disable-line no-param-reassign
    } else {
      setTimeout(() => {
        draw(room, name, message, datetime);
      }, FADE_TIME + 5);
    }
  }

  // Don't show race messages that are not for the current race.
  if (room.startsWith("_race_") && !isChatForThisRace(room)) {
    return;
  }

  // Make sure that the room still exists in the roomList.
  const storedRoom = g.roomList.get(room);
  if (storedRoom === undefined) {
    return;
  }

  // Keep track of how many lines of chat have been spoken in this room.
  storedRoom.chatLine++;

  // Sanitize the input
  message = escapeHTML(message); // eslint-disable-line no-param-reassign

  // Check for links and insert them if present (using Linkify).
  // eslint-disable-next-line no-param-reassign
  message = linkifyHtml(message, {
    attributes: (href: string) => ({
      onclick: `nodeRequire('electron').shell.openExternal('${href}');`,
    }),
    formatHref: () => "#",
    target: "_self",
  });

  // Check for emotes and insert them if present.
  message = fillEmotes(message); // eslint-disable-line no-param-reassign

  // Get the hours and minutes from the time.
  const [hoursString, minutesString] = getHoursAndMinutes(datetime);

  // Construct the chat line.
  let chatLine = `<div id="${room}-chat-text-line-${storedRoom.chatLine}" class="hidden">`;
  chatLine += `<span id="${room}-chat-text-line-${storedRoom.chatLine}-header">`;
  chatLine += `[${hoursString}:${minutesString}] &nbsp; `;

  if (discord) {
    chatLine += '<span class="chat-discord">[Discord]</span> &nbsp; ';
  }

  if (error) {
    // The "chat-pm" class will make it red.
    chatLine += '<span class="chat-pm">[ERROR]</span> ';
  } else if (privateMessage !== null) {
    chatLine += `<span class="chat-pm">[PM ${privateMessage} <strong class="chat-pm">${name}</strong>]</span> &nbsp; `;
  } else if (name !== "!server") {
    chatLine += `&lt;<strong>${name}</strong>&gt; &nbsp; `;
  }
  chatLine += "</span>";

  chatLine +=
    name === "!server"
      ? `<span class="chat-server">${message}</span>`
      : message;
  chatLine += "</div>";

  // Find out whether this is going to "#race-chat-text" or "#lobby-chat-text".
  let destination: string;
  if (room === "lobby") {
    destination = "lobby";
  } else if (room.startsWith("_race_")) {
    destination = "race";
  } else {
    errorShow('Failed to parse the room in the "chat.draw" function.');
    return;
  }

  const destinationElement = $(`#${destination}-chat-text`);

  // Find out if we should automatically scroll down after adding the new line of chat.
  let autoScroll = false;
  const destinationElementHeight = destinationElement.height();
  if (destinationElementHeight === undefined) {
    throw new Error("Failed to get the height of the destination element.");
  }
  let bottomPixel =
    destinationElement.prop("scrollHeight") - destinationElementHeight;
  if (destinationElement.scrollTop() === bottomPixel) {
    // If we are already scrolled to the bottom, then it is ok to automatically scroll.
    autoScroll = true;
  }

  // Add the new line.
  if (datetime === null) {
    destinationElement.append(chatLine);
  } else {
    // We prepend instead of append because the chat history comes in order from most recent to
    // least recent.
    destinationElement.prepend(chatLine);
  }
  $(`#${room}-chat-text-line-${storedRoom.chatLine}`).fadeIn(FADE_TIME);

  // Set indentation for long lines.
  if (room === "lobby") {
    // Indent the text to the "<Username>" to signify that it is a continuation of the last line.
    $(`#${room}-chat-text-line-${storedRoom.chatLine}`).css(
      "padding-left",
      CHAT_INDENT_SIZE,
    );
    $(`#${room}-chat-text-line-${storedRoom.chatLine}`).css(
      "text-indent",
      `-${CHAT_INDENT_SIZE}`,
    );
  }

  // Automatically scroll
  if (autoScroll) {
    const destinationElementHeight2 = destinationElement.height();
    if (destinationElementHeight2 === undefined) {
      throw new Error("Failed to get the height of the destination element.");
    }
    bottomPixel =
      destinationElement.prop("scrollHeight") - destinationElementHeight2;
    $(`#${destination}-chat-text`).scrollTop(bottomPixel);
  }
}

export function isChatForThisRace(room: string): boolean {
  const match = /_race_(\d+)/.exec(room);
  if (match === null) {
    throw new Error("Failed to parse the race ID from the room.");
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const raceIDString = match[1]!;
  const raceID = parseIntSafe(raceIDString);
  return raceID === g.currentRaceID;
}

export function getHoursAndMinutes(datetime: number | null): [string, string] {
  const date = datetime === null ? new Date() : new Date(datetime * 1000);
  const hours = date.getHours();
  let hoursString = hours.toString();
  if (hours < 10) {
    hoursString = `0${hours}`;
  }
  const minutes = date.getMinutes();
  let minutesString = minutes.toString();
  if (minutes < 10) {
    minutesString = `0${minutes}`;
  }

  return [hoursString, minutesString];
}

export function indentAll(room: string): void {
  const storedRoom = g.roomList.get(room);
  if (storedRoom === undefined) {
    return;
  }

  for (let i = 1; i <= storedRoom.chatLine; i++) {
    // If this line overflows, indent it to the "<Username>" to signify that it is a continuation of
    // the last line.
    $(`#${room}-chat-text-line-${i}`).css("padding-left", CHAT_INDENT_SIZE);
    $(`#${room}-chat-text-line-${i}`).css(
      "text-indent",
      `-${CHAT_INDENT_SIZE}`,
    );
  }
}

function fillEmotes(message: string): string {
  // Search through the text for each emote.
  for (const emote of g.emoteList) {
    if (message.includes(emote)) {
      const emoteTag = `<img class="chat-emote" src="img/emotes/${emote}.png" title="${emote}" />`;
      const re = new RegExp(`\\b${emote}\\b`, "g"); // "\b" is a word boundary in regex
      message = message.replace(re, emoteTag); // eslint-disable-line no-param-reassign
    }
  }

  // Special emotes that don't match the filenames.
  if (message.includes("&lt;3")) {
    const emoteTag =
      '<img class="chat-emote" src="img/emotes2/3.png" title="&lt;3" />';
    const re = /&lt;3/g;
    message = message.replaceAll(re, emoteTag); // eslint-disable-line no-param-reassign
  }
  if (message.includes(":thinking:")) {
    const emoteTag =
      '<img class="chat-emote" src="img/emotes2/thinking.svg" title=":thinking:" />';
    const re = /:thinking:/g;
    message = message.replaceAll(re, emoteTag); // eslint-disable-line no-param-reassign
  }

  return message;
}
