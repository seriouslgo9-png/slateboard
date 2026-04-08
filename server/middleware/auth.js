const { users } = require("../data/store");
const { verifyToken } = require("../utils/auth");

async function requireAuth(req, res, next) {
  try {
    const rawToken = req.session.token || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const payload = rawToken ? verifyToken(rawToken) : null;

    if (!payload || !users.has(payload.sub)) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    req.user = users.get(payload.sub);
    next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized." });
  }
}

module.exports = { requireAuth };
