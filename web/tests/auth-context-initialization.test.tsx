import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Code, ConnectError } from "@connectrpc/connect";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ hasToken: false, clearAccessToken: vi.fn() }));
const clients = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  listUserSettings: vi.fn(),
  refreshAccessToken: vi.fn(async () => undefined),
}));

vi.mock("@/auth-state", () => ({
  clearAccessToken: authState.clearAccessToken,
  getAccessToken: () => (authState.hasToken ? "token" : undefined),
}));

vi.mock("@/connect", () => ({
  authServiceClient: {
    getCurrentUser: clients.getCurrentUser,
    signOut: vi.fn(),
  },
  refreshAccessToken: clients.refreshAccessToken,
  userServiceClient: {
    listUserSettings: clients.listUserSettings,
  },
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

const Probe = () => {
  const { currentUser, initializationError, initialize, isInitialized, isUserSettingsInitialized } = useAuth();
  return (
    <div>
      <span data-testid="initialized">{isInitialized ? "yes" : "no"}</span>
      <span data-testid="user-settings-initialized">{isUserSettingsInitialized ? "yes" : "no"}</span>
      <span data-testid="user">{currentUser?.name ?? "none"}</span>
      <span data-testid="error">{initializationError?.message ?? "none"}</span>
      <button type="button" onClick={() => void initialize()}>
        initialize
      </button>
    </div>
  );
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

describe("AuthProvider initialization", () => {
  beforeEach(() => {
    authState.hasToken = false;
    clients.getCurrentUser.mockReset();
    clients.listUserSettings.mockReset();
    clients.refreshAccessToken.mockReset();
    clients.refreshAccessToken.mockResolvedValue(undefined);
    authState.clearAccessToken.mockReset();
  });

  it("resets full readiness while post-sign-in settings are pending", async () => {
    let resolveSettings!: (value: { settings: [] }) => void;
    clients.getCurrentUser.mockResolvedValue({ user: { name: "users/alice", username: "alice" } });
    clients.listUserSettings.mockImplementation(
      () => new Promise<{ settings: [] }>((resolve) => (resolveSettings = resolve)),
    );

    render(<Probe />, { wrapper });

    // Settle the initial unauthenticated pass; this reproduces the state from
    // which PasswordSignInForm and AuthCallback invoke initialize again.
    fireEvent.click(screen.getByRole("button", { name: "initialize" }));
    await waitFor(() => expect(screen.getByTestId("initialized")).toHaveTextContent("yes"));

    authState.hasToken = true;
    fireEvent.click(screen.getByRole("button", { name: "initialize" }));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("users/alice"));
    expect(screen.getByTestId("initialized")).toHaveTextContent("no");
    expect(screen.getByTestId("user-settings-initialized")).toHaveTextContent("no");

    resolveSettings({ settings: [] });
    await waitFor(() => expect(screen.getByTestId("user-settings-initialized")).toHaveTextContent("yes"));
    expect(screen.getByTestId("initialized")).toHaveTextContent("yes");
  });

  it("keeps a verified session when user settings temporarily fail", async () => {
    authState.hasToken = true;
    clients.getCurrentUser.mockResolvedValue({ user: { name: "users/alice", username: "alice" } });
    clients.listUserSettings.mockRejectedValue(new ConnectError("database unavailable", Code.Internal));

    render(<Probe />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "initialize" }));

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("database unavailable"));
    expect(screen.getByTestId("initialized")).toHaveTextContent("no");
    expect(screen.getByTestId("user")).toHaveTextContent("users/alice");
    expect(screen.getByTestId("user-settings-initialized")).toHaveTextContent("no");
    expect(authState.clearAccessToken).not.toHaveBeenCalled();
  });

  it("preserves the token and exposes retryable initialization errors", async () => {
    authState.hasToken = true;
    clients.getCurrentUser.mockRejectedValue(new ConnectError("database unavailable", Code.Internal));

    render(<Probe />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "initialize" }));

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("database unavailable"));
    expect(screen.getByTestId("initialized")).toHaveTextContent("yes");
    expect(authState.clearAccessToken).not.toHaveBeenCalled();
  });

  it("clears the token after a confirmed unauthenticated response", async () => {
    authState.hasToken = true;
    clients.getCurrentUser.mockRejectedValue(new ConnectError("session expired", Code.Unauthenticated));

    render(<Probe />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "initialize" }));

    await waitFor(() => expect(screen.getByTestId("initialized")).toHaveTextContent("yes"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(authState.clearAccessToken).toHaveBeenCalledTimes(1);
  });

  it("preserves the stored session when token refresh fails with a service error", async () => {
    clients.refreshAccessToken.mockRejectedValue(new ConnectError("database unavailable", Code.Internal));

    render(<Probe />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "initialize" }));

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("database unavailable"));
    expect(clients.getCurrentUser).not.toHaveBeenCalled();
    expect(authState.clearAccessToken).not.toHaveBeenCalled();
  });
});
