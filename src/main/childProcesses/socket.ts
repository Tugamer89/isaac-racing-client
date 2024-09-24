// Child process that runs a socket server. We forward along socket messages to the parent process,
// which in turn sends them to the renderer process. All messages to the parent must be in the form
// of "commandName rest of the data".

import dgram from "node:dgram";
import net from "node:net";
import { unpackSocketMsg } from "../../common/socket";
import { processExit } from "./subroutines";

const LOCAL_HOSTNAME = "127.0.0.1";
const REMOTE_HOSTNAME = "isaacracing-tuga.sytes.net";
const TCP_PORT = 9112; // Arbitrarily chosen to not conflict with common IANA ports
const UDP_PORT = 9113; // The same port applies to both the localhost server and the remote server

const tcpSockets: net.Socket[] = [];
let lastUDPClientPort: number | null = null;

init();

function init() {
  // We use a different error message here than in the other child processes.
  process.on("uncaughtException", onUncaughtException);
  process.on("message", onProcessMessage);

  initTCP();
  initUDP();
}

function initTCP() {
  const TCPServer = net.createServer(tcpConnectionListener);

  TCPServer.on("error", (err: Error) => {
    throw err;
  });

  TCPServer.listen(TCP_PORT, LOCAL_HOSTNAME, () => {
    if (process.send === undefined) {
      throw new Error("process.send() does not exist.");
    }
    process.send(`info TCP socket server started on port ${TCP_PORT}.`);
  });
}

function initUDP() {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  const UDPServer = dgram.createSocket("udp4");
  const UDPClient = dgram.createSocket("udp4");

  UDPServer.on("error", (err: Error) => {
    throw err;
  });

  UDPServer.on("message", (msg: Buffer, info: dgram.RemoteInfo) => {
    lastUDPClientPort = info.port;

    // Forward messages from the mod --> the Isaac racing server
    if (msg.length > 0) {
      UDPClient.send(msg, 0, msg.length, UDP_PORT, REMOTE_HOSTNAME);
    }
  });

  UDPServer.bind(UDP_PORT, LOCAL_HOSTNAME);
  process.send(`info UDP socket server started on port ${UDP_PORT}.`);

  UDPClient.on("error", (err: Error) => {
    throw err;
  });

  UDPClient.on("message", (msg: Buffer) => {
    // Forward messages from the Isaac racing server --> the mod
    if (msg.length > 0 && lastUDPClientPort !== null) {
      UDPServer.send(msg, 0, msg.length, lastUDPClientPort, LOCAL_HOSTNAME);
    }
  });
}

function onUncaughtException(err: Error) {
  const getStackTrace = () => {
    const obj = {};
    Error.captureStackTrace(obj, getStackTrace);
    return (obj as Record<string, unknown>)["stack"];
  };

  if (process.send !== undefined) {
    // We forward all errors back to the parent process like in the other child processes. But we
    // use a prefix of "error" here instead of "error:".
    process.send(`error ${err.message} ${getStackTrace()}`, processExit);
  }
}

function onProcessMessage(message: string) {
  // The child will stay alive even if the parent has closed, so we depend on the parent telling us
  // when to die.
  if (message === "exit") {
    process.exit();
  }

  // Forward all messages from the main process to the Racing+ mod.
  for (const socket of tcpSockets) {
    socket.write(message);
  }
}

function tcpConnectionListener(TCPSocket: net.Socket) {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  // Keep track of the newly connected client.
  tcpSockets.push(TCPSocket);

  const clientAddress = `${TCPSocket.remoteAddress}:${TCPSocket.remotePort}`;
  process.send(
    `info Client "${clientAddress}" has connected to the socket server. (${tcpSockets.length} total clients)`,
  );
  process.send("connected");

  TCPSocket.on("data", tcpSocketData);

  TCPSocket.on("close", () => {
    tcpSocketClose(TCPSocket, clientAddress);
  });

  TCPSocket.on("error", (err) => {
    tcpSocketError(err, clientAddress);
  });
}

function tcpSocketData(buffer: Buffer) {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  const lines = buffer.toString();
  for (const line of lines.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine === "") {
      continue;
    }

    const command = unpackSocketMsg(trimmedLine)[0];

    // The client will send a ping on every frame as a means of checking whether or not the socket
    // is closed. These can be ignored.
    if (command === "ping") {
      return;
    }

    // Forward all messages received from the client to the parent process.
    process.send(trimmedLine);
  }
}

function tcpSocketClose(socket: net.Socket, clientAddress: string) {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  // Remove it from our list of sockets.
  const index = tcpSockets.indexOf(socket);
  if (index > -1) {
    tcpSockets.splice(index, 1);
  }

  process.send(
    `info Client "${clientAddress} has disconnected from the socket server. (${tcpSockets.length} total clients)`,
  );

  if (tcpSockets.length === 0) {
    process.send("disconnected");
  }
}

function tcpSocketError(err: Error, clientAddress: string) {
  if (process.send === undefined) {
    throw new Error("process.send() does not exist.");
  }

  process.send(
    `error The TCP socket server got an error for client "${clientAddress}": ${err.message}`,
  );
}
