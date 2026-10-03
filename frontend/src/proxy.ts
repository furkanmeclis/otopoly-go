export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/",
    "/register",
    "/onboarding/:path*",
    "/t/:path*",
    "/profile/:path*",
    "/platform/:path*",
  ],
};
