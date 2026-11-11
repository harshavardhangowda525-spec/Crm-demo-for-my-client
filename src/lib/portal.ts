export const PORTAL_COOKIE = "mh_member_session";
export const PORTAL_PENDING_COOKIE = "mh_member_pending";

export const portalCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
