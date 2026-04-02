/**
 * Shared cookie options helper.
 * Ensures the exact same attributes are used for both
 * res.cookie() (set) and res.clearCookie() (delete).
 * Browsers will NOT remove a cookie if the attributes differ.
 */

const isProduction = process.env.NODE_ENV === "production";

/** Options used when SETTING the auth token cookie */
export const tokenCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

/** Options used when CLEARING the auth token cookie (no maxAge) */
export const clearTokenCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/",
};
