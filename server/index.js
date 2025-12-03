// server/index.js
const express = require("express");
const { ExpressPeerServer } = require("peer");
const cors = require("cors"); // <--- 1. Импорт CORS
const app = express();

app.use(cors()); // <--- 2. Разрешаем запросы с любых доменов (включая localhost:3000)

const port = process.env.PORT || 9000;

const server = app.listen(port, () => {
  console.log(`Сигнальный сервер работает на порту ${port}`);
});

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: "/myapp",
  allow_discovery: true,
});

app.use("/peerjs", peerServer);

app.get("/", (req, res) => {
  res.send("PeerJS Server is running!");
});
