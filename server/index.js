const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieSession = require("cookie-session");
const { Server } = require("socket.io");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const boardRoutes = require("./routes/boards");
const registerBoardHandlers = require("./sockets/boardHandler");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || true,
    credentials: true,
  },
});

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(
  cookieSession({
    name: "slateboard-session",
    secret: process.env.SESSION_SECRET || "development-session-secret",
    httpOnly: true,
    sameSite: "lax",
    secure: false,
  }),
);

app.use("/api/auth", authRoutes);
app.use("/api/boards", boardRoutes);
app.use(express.static(path.join(__dirname, "..", "client")));

io.on("connection", (socket) => {
  registerBoardHandlers(io, socket);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log("Slateboard server listening on port " + port);
});
