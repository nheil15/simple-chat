import { Server } from "socket.io";

let waiting = new Set();
let partners = new Map();

function pairSockets(io, a, b) {
  partners.set(a.id, b.id);
  partners.set(b.id, a.id);
  io.to(a.id).emit("partnerFound");
  io.to(b.id).emit("partnerFound");
}

function detach(socket, io) {
  waiting.delete(socket.id);
  const partnerId = partners.get(socket.id);
  if (partnerId) {
    partners.delete(socket.id);
    partners.delete(partnerId);
    io.to(partnerId).emit("partnerLeft");
  }
}

export default function handler(req, res) {
  if (!res.socket.server.io) {
    const io = new Server(res.socket.server, {
      path: "/api/socket",
    });

    io.on("connection", (socket) => {
      socket.on("findPartner", () => {
        // Remove from waiting queue if already there
        waiting.delete(socket.id);
        // Check for existing partner and clean up
        if (partners.has(socket.id)) {
          const oldPartnerId = partners.get(socket.id);
          partners.delete(socket.id);
          partners.delete(oldPartnerId);
        }

        if (waiting.size > 0) {
          const partnerId = waiting.values().next().value;
          waiting.delete(partnerId);
          const partner = io.sockets.sockets.get(partnerId);
          if (partner) {
            pairSockets(io, socket, partner);
          } else {
            // Partner vanished, requeue current socket
            waiting.add(socket.id);
            io.to(socket.id).emit("waiting");
          }
        } else {
          waiting.add(socket.id);
          io.to(socket.id).emit("waiting");
        }
      });

      socket.on("chatMessage", (text) => {
        const partnerId = partners.get(socket.id);
        if (!partnerId) return;
        io.to(partnerId).emit("chatMessage", { text });
      });

      socket.on("typing", () => {
        const partnerId = partners.get(socket.id);
        if (!partnerId) return;
        io.to(partnerId).emit("typing");
      });

      socket.on("stopFinding", () => {
        detach(socket, io);
        io.to(socket.id).emit("stopped");
      });

      socket.on("next", () => {
        detach(socket, io);
        waiting.add(socket.id);
        io.to(socket.id).emit("waiting");
      });

      socket.on("disconnect", () => {
        detach(socket, io);
      });
    });

    res.socket.server.io = io;
  }

  res.end();
}
