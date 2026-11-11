import { vi } from "vitest";
// "server-only" throws outside React Server Components; tests run in plain Node.
vi.mock("server-only", () => ({}));
