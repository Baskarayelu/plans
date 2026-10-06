// Node 24 has WebCrypto; make sure tests see crypto.getRandomValues like the app does.
if (!globalThis.crypto) globalThis.crypto = require("node:crypto").webcrypto;
