const express = require("express");
const { requireAuth } = require("../middleware/auth");
const {
  createBoard,
  createInvite,
  getBoard,
  listBoardsForUser,
  serializeBoard,
} = require("../data/store");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const items = listBoardsForUser(req.user.id).map((board) => ({
      roomKey: board.roomKey,
      title: board.title,
      thumbnail: board.thumbnail,
      updatedAt: board.updatedAt,
    }));
    res.status(200).json(items);
  } catch (error) {
    res.status(500).json({ message: "Board list failed." });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const board = createBoard(req.user.id);
    if (req.body.title) {
      board.title = String(req.body.title).trim() || board.title;
    }
    if (req.body.background) {
      board.background = String(req.body.background);
    }
    res.status(201).json({ roomKey: board.roomKey, boardId: board.id });
  } catch (error) {
    res.status(500).json({ message: "Board creation failed." });
  }
});

router.get("/:roomKey", async (req, res) => {
  try {
    const board = getBoard(req.params.roomKey);
    if (!board) {
      res.status(404).json({ message: "Board not found." });
      return;
    }

    res.status(200).json({ board: serializeBoard(board), strokes: board.strokes });
  } catch (error) {
    res.status(500).json({ message: "Board fetch failed." });
  }
});

router.patch("/:roomKey", requireAuth, async (req, res) => {
  try {
    const board = getBoard(req.params.roomKey);
    if (!board) {
      res.status(404).json({ message: "Board not found." });
      return;
    }

    if (board.ownerId !== req.user.id) {
      res.status(403).json({ message: "Only the owner can update this board." });
      return;
    }

    if (req.body.title) {
      board.title = String(req.body.title).trim() || board.title;
    }

    if (req.body.background) {
      board.background = String(req.body.background);
    }

    if (req.body.defaultRole) {
      board.defaultRole = req.body.defaultRole === "viewer" ? "viewer" : "editor";
    }

    board.updatedAt = new Date().toISOString();
    res.status(200).json({ board: serializeBoard(board) });
  } catch (error) {
    res.status(500).json({ message: "Board update failed." });
  }
});

router.post("/:roomKey/invite", requireAuth, async (req, res) => {
  try {
    const board = getBoard(req.params.roomKey);
    if (!board) {
      res.status(404).json({ message: "Board not found." });
      return;
    }

    if (board.ownerId !== req.user.id) {
      res.status(403).json({ message: "Only the owner can create invites." });
      return;
    }

    const defaultRole = req.body.defaultRole === "viewer" ? "viewer" : "editor";
    board.defaultRole = defaultRole;
    const invite = createInvite(board.roomKey, req.user.id, defaultRole);
    const origin = req.protocol + "://" + req.get("host");
    res.status(201).json({
      inviteUrl: origin + "/board.html?roomKey=" + encodeURIComponent(board.roomKey),
      roomKey: board.roomKey,
      defaultRole: invite.defaultRole,
      expiresAt: invite.expiresAt,
    });
  } catch (error) {
    res.status(500).json({ message: "Invite creation failed." });
  }
});

module.exports = router;
