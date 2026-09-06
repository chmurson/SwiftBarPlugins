"use strict";

const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");

class AppServer {
  constructor(command, { timeoutMs = 12000, env = process.env, args = ["app-server"] } = {}) {
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
    this.failure = null;
    this.child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    // Never surface raw server stderr (it can include account/configuration data).
    this.child.stderr.resume();
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", line => this.receive(line));
    this.child.stdin.on("error", () => this.fail(new Error("Codex connection closed")));
    this.child.on("error", error => {
      const failure = new Error(error.code === "ENOENT" ? "Codex CLI not found; install Codex or set CODEX_USAGE_CODEX" : "Could not start Codex App Server");
      failure.code = error.code;
      this.fail(failure);
    });
    this.child.on("exit", code => {
      clearTimeout(this.killTimer);
      if (!this.closed) this.fail(new Error(`Codex App Server exited (${code ?? "signal"}); check codex login and CLI configuration`));
    });
  }

  receive(line) {
    let message;
    try { message = JSON.parse(line); } catch { return this.fail(new Error("Invalid response from Codex App Server")); }
    // A read-only client cannot fulfill requests for interactive authentication.
    if (message.method && message.id !== undefined) {
      this.send({ id: message.id, error: { code: -32601, message: "Unsupported by read-only usage client" } });
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      const error = new Error(`${pending.method} failed (${message.error.code ?? "unknown"}); check Codex login or update the CLI`);
      error.code = message.error.code;
      pending.reject(error);
    } else pending.resolve(message.result);
  }

  send(message) {
    if (!this.closed && !this.child.stdin.destroyed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = this.timeoutMs) {
    if (this.failure || this.closed) return Promise.reject(this.failure || new Error("Codex connection closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out; try Refresh`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.send({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  async initialize() {
    await this.request("initialize", { clientInfo: { name: "codex_usage_swiftbar", title: "Codex Usage SwiftBar", version: "0.2.0" } });
    this.send({ method: "initialized" });
  }

  fail(error) {
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.fail(new Error("Codex connection closed"));
    this.lines.close();
    this.child.stdin.end();
    this.child.kill();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.killTimer = setTimeout(() => this.child.kill("SIGKILL"), 1000);
      this.killTimer.unref();
    }
  }
}

module.exports = { AppServer };
