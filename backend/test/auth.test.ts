/** Checks that login (Okta) settings are validated and that requests without a valid token are rejected. */
import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { oktaAuth } from "../src/auth.js";

const start = () => {
  const app = express();
  app.use("/api", oktaAuth());
  app.get("/api/ping", (_req, res) => void res.json({ ok: true }));
  const server = app.listen(0);
  return { server, url: `http://localhost:${(server.address() as AddressInfo).port}/api/ping` };
};

describe("okta auth middleware", () => {
  const saved = process.env.OKTA_ISSUER;
  afterEach(() => void (saved === undefined ? delete process.env.OKTA_ISSUER : (process.env.OKTA_ISSUER = saved)));

  it("always refuses to start without OKTA_ISSUER, whatever else is set in the environment", () => {
    delete process.env.OKTA_ISSUER;
    expect(() => oktaAuth()).toThrow(/OKTA_ISSUER must be set/);
    process.env.ALLOW_INSECURE_DEV_AUTH = "true"; // the old bypass flag must have no effect
    expect(() => oktaAuth()).toThrow(/OKTA_ISSUER must be set/);
    delete process.env.ALLOW_INSECURE_DEV_AUTH;
  });

  it("a custom-server issuer needs OKTA_CLIENT_ID too (tokens must be issued to this app)", () => {
    process.env.OKTA_ISSUER = "https://example.okta.com/oauth2/default";
    delete process.env.OKTA_CLIENT_ID;
    expect(() => oktaAuth()).toThrow(/OKTA_CLIENT_ID/);
    process.env.OKTA_CLIENT_ID = "0oaXYZ";
    expect(() => oktaAuth()).not.toThrow();
    delete process.env.OKTA_CLIENT_ID;
  });

  it("org-server issuer requires OKTA_CLIENT_ID (ID-token audience)", () => {
    process.env.OKTA_ISSUER = "https://example.oktapreview.com";
    delete process.env.OKTA_CLIENT_ID;
    expect(() => oktaAuth()).toThrow(/OKTA_CLIENT_ID/);
    process.env.OKTA_CLIENT_ID = "0oaXYZ";
    expect(() => oktaAuth()).not.toThrow();
    delete process.env.OKTA_CLIENT_ID;
  });

  it("rejects an unknown OKTA_IDENTITY_CLAIM", () => {
    process.env.OKTA_ISSUER = "https://example.okta.com/oauth2/default";
    process.env.OKTA_CLIENT_ID = "0oaXYZ";
    process.env.OKTA_IDENTITY_CLAIM = "username";
    expect(() => oktaAuth()).toThrow(/OKTA_IDENTITY_CLAIM/);
    process.env.OKTA_IDENTITY_CLAIM = "email";
    expect(() => oktaAuth()).not.toThrow();
    delete process.env.OKTA_IDENTITY_CLAIM;
    delete process.env.OKTA_CLIENT_ID;
  });

  it("returns 401 without a token or with a bad one when enabled", async () => {
    process.env.OKTA_ISSUER = "https://example.okta.com/oauth2/default";
    process.env.OKTA_CLIENT_ID = "0oaXYZ";
    const { server, url } = start();
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { authorization: "Bearer not.a.jwt" } })).status).toBe(401);
    server.close();
    delete process.env.OKTA_CLIENT_ID;
  });
});
