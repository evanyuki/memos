import { Code, ConnectError } from "@connectrpc/connect";

export const isUnauthenticatedError = (error: unknown): boolean => error instanceof ConnectError && error.code === Code.Unauthenticated;
