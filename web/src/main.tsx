import "@rainbow-me/rainbowkit/styles.css";
import "./styles/tokens.css";
import "./styles/app.css";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { App } from "./App";
import { config } from "./wagmi";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

// RainbowKit's modal takes the Coral ink and radius so it reads as part of Qrow.
const theme = lightTheme({
  accentColor: "oklch(21% 0.012 38)",
  accentColorForeground: "oklch(97% 0.006 55)",
  borderRadius: "small",
  fontStack: "system",
  overlayBlur: "small",
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact" appInfo={{ appName: "Qrow" }}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
