const express = require("express");
const bcrypt = require("bcrypt");
const { users, emailIndex, randomId } = require("../data/store");
const { signToken, verifyToken } = require("../utils/auth");

const router = express.Router();

function toUserPayload(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  };
}

router.post("/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const displayName = String(req.body.displayName || email.split("@")[0] || "User").trim();

    if (!email || !password) {
      res.status(400).json({ message: "Email and password are required." });
      return;
    }

    if (emailIndex.has(email)) {
      res.status(409).json({ message: "User already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = {
      id: randomId("user"),
      email: email,
      passwordHash: passwordHash,
      displayName: displayName,
      role: "student",
      createdAt: new Date().toISOString(),
    };

    users.set(user.id, user);
    emailIndex.set(email, user.id);

    const token = signToken(user);
    req.session.token = token;
    res.status(201).json({ token: token, user: toUserPayload(user) });
  } catch (error) {
    res.status(500).json({ message: "Auth register failed." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const userId = emailIndex.get(email);

    if (!userId) {
      res.status(401).json({ message: "Invalid credentials." });
      return;
    }

    const user = users.get(userId);
    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      res.status(401).json({ message: "Invalid credentials." });
      return;
    }

    const token = signToken(user);
    req.session.token = token;
    res.status(200).json({ token: token, user: toUserPayload(user) });
  } catch (error) {
    res.status(500).json({ message: "Auth login failed." });
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const existing = req.session.token || req.body.token;
    const payload = existing ? verifyToken(existing) : null;

    if (!payload || !users.has(payload.sub)) {
      res.status(401).json({ message: "No valid session." });
      return;
    }

    const user = users.get(payload.sub);
    const token = signToken(user);
    req.session.token = token;
    res.status(200).json({ token: token, user: toUserPayload(user) });
  } catch (error) {
    res.status(500).json({ message: "Auth refresh failed." });
  }
});

router.get("/me", async (req, res) => {
  try {
    const existing = req.session.token || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const payload = existing ? verifyToken(existing) : null;

    if (!payload || !users.has(payload.sub)) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    res.status(200).json({ user: toUserPayload(users.get(payload.sub)) });
  } catch (error) {
    res.status(500).json({ message: "Auth me failed." });
  }
});

router.delete("/logout", async (req, res) => {
  try {
    req.session = null;
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "Logout failed." });
  }
});

module.exports = router;
