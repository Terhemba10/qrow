import { lazy, Suspense, type ReactElement } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { ComingSoon } from "./components/ComingSoon";
import { Logo } from "./components/Logo";
import { WalletButton } from "./components/WalletButton";
import { ESCROW, IS_DEMO, NETWORK_NAME } from "./config/network";
import { FEEDBACK_URL, TABS, isLive, type TabId } from "./config/tabs";
import { captureReferral } from "./lib/staking";
import { HowToTestPage, PrivacyPage } from "./pages/InfoPages";
import { LaunchPage } from "./pages/LaunchPage";
import { MarketPage } from "./pages/MarketPage";
import { NewsPage } from "./pages/NewsPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { ReceivePage } from "./pages/ReceivePage";
import { ReviewPage } from "./pages/ReviewPage";
import { SendPage } from "./pages/SendPage";
import { ShopPage } from "./pages/ShopPage";
import { StakingPage } from "./pages/StakingPage";
import { StartPage } from "./pages/StartPage";

captureReferral(window.location.search);

// Dev-only research page: import.meta.env.DEV is false in production builds, so this chunk isn't emitted.
const QorexCheckPage = import.meta.env.DEV ? lazy(() => import("./pages/QorexCheckPage").then((m) => ({ default: m.QorexCheckPage }))) : null;

const live = (id: TabId, page: ReactElement) => (isLive(id) ? page : <ComingSoon id={id} />);

export function App() {
  return (
    <>
      <header className="topbar">
        <div className="topbar__inner">
          <NavLink to="/" className="brand" aria-label="Qrow, home">
            <Logo />
          </NavLink>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>
              Start
            </NavLink>
            {TABS.map((t) => (
              <NavLink key={t.id} to={t.path}>
                {t.label}
              </NavLink>
            ))}
          </nav>
          <span className="net">{NETWORK_NAME}</span>
          <WalletButton />
        </div>
      </header>
      <p className="beta-banner" role="note">
        <strong>Public beta: QoreChain testnet,</strong> tokens have no value.
      </p>
      {IS_DEMO && (
        <p className="demo-banner" role="note">
          Demo escrow (<span className="mono">{ESCROW.slice(0, 10)}…</span>): refunds after 10 minutes so they can be shown live. The real Qrow escrow keeps the 7-day rule.
        </p>
      )}
      <main id="main">
        <Routes>
          <Route path="/" element={<StartPage />} />
          <Route path="/send" element={live("send", <SendPage />)} />
          <Route path="/review" element={live("send", <ReviewPage />)} />
          <Route path="/receive" element={live("receive", <ReceivePage />)} />
          <Route path="/portfolio" element={live("portfolio", <PortfolioPage />)} />
          <Route path="/shop" element={live("shop", <ShopPage />)} />
          <Route path="/market" element={live("market", <MarketPage />)} />
          <Route path="/staking" element={live("staking", <StakingPage />)} />
          <Route path="/news" element={live("news", <NewsPage />)} />
          <Route path="/launch" element={live("launch", <LaunchPage />)} />
          <Route path="/how-to-test" element={<HowToTestPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          {QorexCheckPage && (
            <Route
              path="/dev/qorex-check"
              element={
                <Suspense fallback={null}>
                  <QorexCheckPage />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="footer">
        <a className="btn btn--quiet" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
          Feedback
        </a>
        <p className="hint">
          Built in Doha, Qatar, Middle East. Qrow is open source (MIT), a community project, not made by QoreChain. Testnet only: never send real funds. <NavLink to="/how-to-test">How to test</NavLink>, <NavLink to="/privacy">Privacy and testnet</NavLink>.
        </p>
      </footer>
    </>
  );
}
