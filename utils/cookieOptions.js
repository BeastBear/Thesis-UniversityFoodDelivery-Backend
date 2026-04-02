/**
 * Cookie options helpers — evaluated at REQUEST TIME (not module load time)
 * so that process.env.NODE_ENV is always available after dotenv.config() runs.
 *
 * Browsers will NOT remove a cookie unless clearCookie options match
 * the options used when the cookie was originally set.
 */

/** Options for res.cookie() when setting the auth token */
export const getTokenCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };
};

/** Options for res.clearCookie() when removing the auth token */
export const getClearCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  };
};
