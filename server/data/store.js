const boards = new Map();
const users = new Map();
const emailIndex = new Map();
const invites = new Map();

const PRESENCE_COLORS = [
  "#FF6B6B",
  "#FFD93D",
  "#C4B5FD",
  "#2EC4B6",
  "#FF9F1C",
  "#7BD389",
  "#6BCBFF",
  "#FF8FAB",
];

function randomId(prefix) {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

function createRoomKey() {
  const part = Math.random().toString(36).slice(2, 6).toUpperCase();
  return "SLATE-" + part;
}

function getBoard(roomKey) {
  return boards.get(String(roomKey || "").toUpperCase()) || null;
}

function getInvite(roomKey) {
  return invites.get(String(roomKey || "").toUpperCase()) || null;
}

function listBoardsForUser(userId) {
  return Array.from(boards.values()).filter((board) => board.ownerId === userId);
}

function ensureUniqueRoomKey() {
  let roomKey = createRoomKey();
  while (boards.has(roomKey)) {
    roomKey = createRoomKey();
  }
  return roomKey;
}

function createBoard(ownerId) {
  const boardId = randomId("board");
  const roomKey = ensureUniqueRoomKey();
  const board = {
    id: boardId,
    roomKey: roomKey,
    ownerId: ownerId,
    title: "Untitled board",
    background: "blank",
    thumbnail: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    strokes: [],
    strokeBuffers: {},
    deletedStrokeIds: new Set(),
    collaborators: {},
    collaboratorRoles: {},
    defaultRole: "editor",
  };

  board.collaboratorRoles[ownerId] = "owner";
  boards.set(roomKey, board);
  return board;
}

function createInvite(boardRoomKey, invitedBy, defaultRole) {
  const invite = {
    id: randomId("invite"),
    boardRoomKey: String(boardRoomKey || "").toUpperCase(),
    invitedBy: invitedBy,
    defaultRole: defaultRole || "viewer",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    usedCount: 0,
    createdAt: new Date().toISOString(),
  };

  invites.set(invite.boardRoomKey, invite);
  return invite;
}

function getRoleForActor(board, actor) {
  if (!board || !actor) {
    return "viewer";
  }

  if (board.ownerId === actor.id) {
    return "owner";
  }

  if (board.collaboratorRoles[actor.id]) {
    return board.collaboratorRoles[actor.id];
  }

  const invite = getInvite(board.roomKey);
  if (invite) {
    return invite.defaultRole || "viewer";
  }

  return board.defaultRole || "viewer";
}

function assignPresenceColor(actorId) {
  let sum = 0;
  const value = String(actorId || "");
  for (let i = 0; i < value.length; i += 1) {
    sum += value.charCodeAt(i);
  }
  return PRESENCE_COLORS[sum % PRESENCE_COLORS.length];
}

function serializeBoard(board) {
  return {
    boardId: board.id,
    roomKey: board.roomKey,
    title: board.title,
    background: board.background,
    thumbnail: board.thumbnail,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    defaultRole: board.defaultRole,
    strokes: board.strokes,
  };
}

function serializeCollaborator(collaborator) {
  return {
    id: collaborator.id,
    displayName: collaborator.displayName,
    role: collaborator.role,
    color: collaborator.color,
    guest: Boolean(collaborator.guest),
  };
}

module.exports = {
  boards,
  users,
  emailIndex,
  invites,
  PRESENCE_COLORS,
  randomId,
  createBoard,
  createInvite,
  createRoomKey,
  getBoard,
  getInvite,
  getRoleForActor,
  assignPresenceColor,
  listBoardsForUser,
  serializeBoard,
  serializeCollaborator,
};
