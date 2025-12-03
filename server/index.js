const express = require("express");
const { ExpressPeerServer } = require("peer");
const cors = require("cors");
const app = express();

// Разрешаем CORS, чтобы клиент с другого домена мог стучаться
app.use(cors());

const port = process.env.PORT || 9000;

const server = app.listen(port, () => {
  console.log(`Battleship Signaling Server running on port ${port}`);
});

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: "/myapp",
  allow_discovery: true,
  proxied: true // ВАЖНО для Render (так как он работает за прокси Nginx)
});

app.use("/peerjs", peerServer);

app.get("/", (req, res) => {
  res.send("Battleship Signaling Server is running! (v1.0)");
});