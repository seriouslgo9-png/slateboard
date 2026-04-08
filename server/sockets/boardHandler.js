const {
  assignPresenceColor,
  getBoard,
  getRoleForActor,
  serializeCollaborator,
  users,
} = require("../data/store");
const { verifyToken } = require("../utils/auth");

function getActor(payload) {
  const tokenPayload = payload && payload.token ? verifyToken(payload.token) : null;
  if (tokenPayload && users.has(tokenPayload.sub)) {
    const user = users.get(tokenPayload.sub);
    return {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
      guest: false,
    };
  }

  return {
    id: payload && payload.guestId ? payload.guestId : "guest-" + Math.random().toString(36).slice(2, 8),
    displayName: "Guest",
    role: "guest",
    guest: true,
  };
}

function canDraw(role) {
  return role === "owner" || role === "editor";
}

function broadcastBoardState(io, board) {
  io.to(board.roomKey).emit("board:state", {
    board: {
      roomKey: board.roomKey,
      title: board.title,
      background: board.background,
      defaultRole: board.defaultRole,
    },
    strokes: board.strokes.slice(-1000),
    collaborators: Object.values(board.collaborators).map(serializeCollaborator),
  });
}

module.exports = function registerBoardHandlers(io, socket) {
  socket.on("board:join", async (payload) => {
    try {
      if (!payload || !payload.roomKey) {
        socket.emit("error", { code: "ROOM_KEY_REQUIRED", message: "Room key is required." });
        return;
      }

      const board = getBoard(payload.roomKey);
      if (!board) {
        socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Board not found." });
        return;
      }

      const actor = getActor(payload);
      actor.role = getRoleForActor(board, actor);
      actor.color = assignPresenceColor(actor.id);
      socket.data.roomKey = board.roomKey;
      socket.data.actor = actor;
      board.collaboratorRoles[actor.id] = actor.role;
      board.collaborators[actor.id] = actor;

      await socket.join(board.roomKey);
      socket.emit("permission:ack", {
        userId: actor.id,
        newRole: actor.role,
      });
      broadcastBoardState(io, board);
    } catch (error) {
      socket.emit("error", { code: "JOIN_FAILED", message: "Unable to join board." });
    }
  });

  socket.on("cursor:move", async (payload) => {
    try {
      const roomKey = socket.data.roomKey;
      const actor = socket.data.actor;
      const board = getBoard(roomKey);
      if (!board || !actor || !payload) {
        return;
      }

      socket.to(roomKey).emit("cursor:remote", {
        userId: actor.id,
        displayName: actor.displayName,
        role: actor.role,
        color: actor.color,
        x: Number(payload.x),
        y: Number(payload.y),
      });
    } catch (error) {
      socket.emit("error", { code: "CURSOR_FAILED", message: "Unable to broadcast cursor." });
    }
  });

  socket.on("stroke:start", async (payload) => {
    try {
      const roomKey = socket.data.roomKey;
      const board = getBoard(roomKey);
      const actor = socket.data.actor;
      if (!board || !payload || !payload.strokeId) {
        return;
      }

      if (!actor || !canDraw(actor.role)) {
        socket.emit("error", { code: "DRAW_FORBIDDEN", message: "You do not have permission to draw." });
        return;
      }

      board.strokeBuffers[payload.strokeId] = {
        strokeId: payload.strokeId,
        authorId: actor.id,
        tool: payload.tool,
        style: payload.style,
        points: payload.startPoint ? [payload.startPoint] : [],
      };
      socket.to(roomKey).emit("stroke:remote", board.strokeBuffers[payload.strokeId]);
    } catch (error) {
      socket.emit("error", { code: "STROKE_START_FAILED", message: "Unable to start stroke." });
    }
  });

  socket.on("stroke:point", async (payload) => {
    try {
      const roomKey = socket.data.roomKey;
      const board = getBoard(roomKey);
      const actor = socket.data.actor;
      if (!board || !payload || !board.strokeBuffers[payload.strokeId]) {
        return;
      }

      if (!actor || !canDraw(actor.role)) {
        return;
      }

      board.strokeBuffers[payload.strokeId].points.push(payload.point);
      socket.to(roomKey).emit("stroke:remote", {
        strokeId: payload.strokeId,
        authorId: actor.id,
        tool: board.strokeBuffers[payload.strokeId].tool,
        style: board.strokeBuffers[payload.strokeId].style,
        points: board.strokeBuffers[payload.strokeId].points,
      });
    } catch (error) {
      socket.emit("error", { code: "STROKE_POINT_FAILED", message: "Unable to add stroke point." });
    }
  });

  socket.on("stroke:end", async (payload) => {
    try {
      const roomKey = socket.data.roomKey;
      const board = getBoard(roomKey);
      const actor = socket.data.actor;
      if (!board || !payload || !board.strokeBuffers[payload.strokeId]) {
        return;
      }

      if (!actor || !canDraw(actor.role)) {
        return;
      }

      const buffer = board.strokeBuffers[payload.strokeId];
      if (Array.isArray(payload.finalPoints) && payload.finalPoints.length > 0) {
        buffer.points = payload.finalPoints;
      }

      const existingIndex = board.strokes.findIndex(function (stroke) {
        return stroke.strokeId === buffer.strokeId;
      });
      if (existingIndex >= 0) {
        board.strokes[existingIndex] = buffer;
      } else {
        board.strokes.push(buffer);
      }
      delete board.strokeBuffers[payload.strokeId];
      board.updatedAt = new Date().toISOString();
      io.to(roomKey).emit("stroke:remote", buffer);
    } catch (error) {
      socket.emit("error", { code: "STROKE_END_FAILED", message: "Unable to finish stroke." });
    }
  });

  socket.on("stroke:delete", async (payload) => {
    try {
      const roomKey = socket.data.roomKey;
      const board = getBoard(roomKey);
      const actor = socket.data.actor;
      if (!board || !payload || !Array.isArray(payload.strokeIds) || !actor) {
        return;
      }

      if (!canDraw(actor.role)) {
        return;
      }

      const ids = payload.strokeIds.map(String);
      board.strokes = board.strokes.filter(function (stroke) {
        return ids.indexOf(stroke.id || stroke.strokeId) === -1 && ids.indexOf(stroke.strokeId) === -1;
      });
      board.updatedAt = new Date().toISOString();
      io.to(roomKey).emit("stroke:delete", { strokeIds: ids });
    } catch (error) {
      socket.emit("error", { code: "STROKE_DELETE_FAILED", message: "Unable to delete strokes." });
    }
  });

  socket.on("permission:set", async (payload) => {
    try {
      const roomKey = socket.data.roomKey;
      const board = getBoard(roomKey);
      const actor = socket.data.actor;
      if (!board || !actor || actor.id !== board.ownerId || !payload || !payload.targetUserId) {
        return;
      }

      const nextRole = payload.role === "viewer" ? "viewer" : payload.role === "owner" ? "owner" : "editor";
      board.collaboratorRoles[payload.targetUserId] = nextRole;
      if (board.collaborators[payload.targetUserId]) {
        board.collaborators[payload.targetUserId].role = nextRole;
      }

      io.to(roomKey).emit("permission:ack", {
        userId: payload.targetUserId,
        newRole: nextRole,
      });
      broadcastBoardState(io, board);
    } catch (error) {
      socket.emit("error", { code: "PERMISSION_FAILED", message: "Unable to update permissions." });
    }
  });

  socket.on("disconnect", async () => {
    try {
      const roomKey = socket.data.roomKey;
      const actor = socket.data.actor;
      if (!roomKey || !actor) {
        return;
      }

      const board = getBoard(roomKey);
      if (!board) {
        return;
      }

      delete board.collaborators[actor.id];
      broadcastBoardState(io, board);
    } catch (error) {
      socket.emit("error", { code: "DISCONNECT_FAILED", message: "Disconnect cleanup failed." });
    }
  });
};
