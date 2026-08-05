import { doubleCsrf } from "csrf-csrf";
import config from "../config/index.js";

// Ensure cookie secret is long enough, csrf-csrf requires good entropy
// We'll use the secret directly.
import { Request } from "express";

export const {
  invalidCsrfTokenError, // This is an error instance thrown when CSRF validation fails
  generateCsrfToken: generateToken, // A method to generate the CSRF token
  doubleCsrfProtection, // The middleware to validate the CSRF token
} = doubleCsrf({
  getSecret: () => config.cookie.secret, // Must match the cookie-parser secret
  cookieName: "x-csrf-token", // Name of the cookie containing the encrypted token/secret
  cookieOptions: {
    httpOnly: true,
    sameSite: config.env === "production" ? "none" : "lax", // sameSite: "none" required for cross-origin
    path: "/",
    secure: config.env === "production",
  },
  size: 64, // The size of the generated tokens in bits
  ignoredMethods: ["GET", "HEAD", "OPTIONS"], // Methods to ignore (safe methods)
  getCsrfTokenFromRequest: (req: Request) => req.headers["x-csrf-token"] as string, // How the token is sent back from client
  getSessionIdentifier: (req: Request) => "session", // Unused since we are using cookie-parser, but required by the types
});
