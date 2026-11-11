/**
 * Checks the Okta login token on each request and works out the user's email and role.
 */
import type { RequestHandler } from "express";
import { AppDataSource } from "./db.js";
import type { AppRole } from "./models/AppUser.js";
import { findUser } from "./services/users.js";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

declare module "express-serve-static-core" {
  interface Request {
    user?: JWTPayload;
    userEmail?: string;
    userRole?: AppRole;
    userEmployeeId?: string | null;
  }
}

export function oktaAuth(): RequestHandler {
  const issuer = process.env.OKTA_ISSUER?.replace(/\/$/, "");
  if (!issuer) {
    if (process.env.NODE_ENV === "production") throw new Error("OKTA_ISSUER must be set in production: refusing to start with authentication disabled.");
    console.warn("Okta auth DISABLED: OKTA_ISSUER is not set; every request acts as a local superadmin (development only).");
    return (req, _res, next) => {
      req.userEmail = "dev@local";
      req.userRole = "superadmin";
      next();
    };
  }
  const orgServer = !new URL(issuer).pathname.includes("/oauth2");
  const audience = orgServer ? process.env.OKTA_CLIENT_ID : (process.env.OKTA_AUDIENCE ?? "api://default");
  if (!audience) throw new Error("OKTA_ISSUER is the Okta org server, so OKTA_CLIENT_ID (the SPA's client id) is required: it is the ID token's audience.");
  console.log(`Okta auth ENABLED: ${orgServer ? "org server, verifying ID tokens" : "verifying access tokens"} (issuer=${issuer}, audience=${audience})`);
  const identityClaim = process.env.OKTA_IDENTITY_CLAIM?.trim();
  if (identityClaim && !["preferred_username", "email", "sub"].includes(identityClaim)) {
    throw new Error(`OKTA_IDENTITY_CLAIM must be "preferred_username", "email" or "sub" (got "${identityClaim}"), or leave it empty.`);
  }
  const jwks = createRemoteJWKSet(new URL(orgServer ? `${issuer}/oauth2/v1/keys` : `${issuer}/v1/keys`));

  return async (req, res, next) => {
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!token) return void res.status(401).json({ error: "Authentication required" });
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer, audience, algorithms: ["RS256"] }));
    } catch (e) {
      const err = e as { code?: string; claim?: string; message?: string };
      const reason = [err.code, err.claim && `claim: ${err.claim}`].filter(Boolean).join(", ");
      console.warn(`Okta token rejected: ${err.message} (expected issuer=${issuer}, audience=${audience})`);
      return void res.status(401).json({ error: "Invalid or expired token", reason });
    }

    const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
    const raw = identityClaim
      ? [payload[identityClaim]]
      : [payload.preferred_username, payload.email, typeof payload.sub === "string" && payload.sub.includes("@") ? payload.sub : undefined];
    const ids = [...new Set(raw.map(norm).filter(Boolean))];
    const user = await findUser(AppDataSource.manager, ids);
    if (!user) return void res.status(403).json({ error: "Access denied", email: ids[0] ?? "", identifiers: ids });
    if (!user.isActive) return void res.status(403).json({ error: "Account deactivated", email: user.email });
    req.user = payload;
    req.userEmail = user.email;
    req.userRole = user.role;
    req.userEmployeeId = user.employeeId;
    next();
  };
}
