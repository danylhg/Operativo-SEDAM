import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { requestLogger } from "./middlewares/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { payloadTooLarge, malformedJson, unhandledError } from "./middlewares/errors.js";
import { notFound } from "./middlewares/notFound.js";

import systemRoutes from "./routes/system.routes.js";
import authRoutes from "./routes/auth.routes.js";
import catalogRoutes from "./routes/catalog.routes.js";
import operacionesRoutes from "./routes/operaciones.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import mapaRoutes from "./routes/mapa.routes.js";
import rutasRoutes from "./routes/rutas.routes.js";
import trackingRoutes from "./routes/tracking.routes.js";
import vitalesRoutes from "./routes/vitales.routes.js";
import streamingRoutes from "./routes/streaming.routes.js";
import zonaRoutes from "./routes/zona.routes.js";
import validationRoutes from "./routes/validation.routes.js";
import replayRoutes from "./routes/replay.routes.js";
import pttRoutes from "./routes/ptt.routes.js";

const app = express();

app.use(cors({
  origin: true,
  credentials: true,
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-File-Name",
    "X-Attachment-Kind",
    "X-Duration-Ms"
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}));

app.options("*", cors());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const webRoot = join(__dirname, "..");

app.use("/Operaciones", express.static(webRoot));
app.use(express.static(webRoot));

app.use(requestLogger);

app.use("/", systemRoutes);
app.use("/", authRoutes);
app.use("/", catalogRoutes);
app.use("/", operacionesRoutes);
app.use("/", chatRoutes);
app.use("/", mapaRoutes);
app.use("/", rutasRoutes);
app.use("/", trackingRoutes);
app.use("/", vitalesRoutes);
app.use("/", streamingRoutes);
app.use("/", zonaRoutes);
app.use("/", validationRoutes);
app.use("/", replayRoutes);
app.use("/", pttRoutes);

app.use(payloadTooLarge);
app.use(malformedJson);
app.use(unhandledError);
app.use(notFound);

export { app };
