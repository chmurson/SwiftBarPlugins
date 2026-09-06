#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const { createInterface } = require("node:readline");
let initialized = false;
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, `${request.method}\n`);
  if (request.method === "initialize") {
    if (process.env.FAKE_MODE === "timeout") return;
    send({ id: request.id, result: { userAgent: "test" } });
    return;
  }
  if (request.method === "initialized") { initialized = true; return; }
  if (!initialized) return send({ id: request.id, error: { code: -32000, message: "Handshake not complete" } });
  if (request.method === "account/usage/read") return send({ id: request.id, error: { code: -32601, message: "Unsupported" } });
  if (process.env.FAKE_MODE === "error") return send({ id: request.id, error: { code: 401, message: "secret-token-must-not-appear" } });
  send({ method: "account/updated", params: { authMode: "chatgpt" } });
  send({ id: request.id, result: {
    rateLimits: { primary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 7200 }, secondary: null, credits: { balance: "0", hasCredits: false, unlimited: false }, planType: "prolite" },
    rateLimitResetCredits: { availableCount: 3 },
  } });
});
