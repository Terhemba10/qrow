import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { Logo } from "./components/Logo";
import { WalletButton } from "./components/WalletButton";
import { NETWORK_NAME } from "./config/network";
import { PortfolioPage } from "./pages/PortfolioPage";
import { ReceivePage } from "./pages/ReceivePage";
import { ReviewPage } from "./pages/ReviewPage";
import { SendPage } from "./pages/SendPage";

export function App() {
  return (
    <>
      <header className="topbar">
        <div className="topbar__inner">
          <NavLink to="/send" className="brand" aria-label="Qrow, home">
            <Logo />
          </NavLink>
          <nav className="nav" aria-label="Main">
            <NavLink to="/send">Send</NavLink>
            <NavLink to="/receive">Receive</NavLink>
            <NavLink to="/portfolio">Portfolio</NavLink>
          </nav>
          <span className="net">{NETWORK_NAME}</span>
          <WalletButton />
        </div>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<Navigate to="/send" replace />} />
          <Route path="/send" element={<SendPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/receive" element={<ReceivePage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="*" element={<Navigate to="/send" replace />} />
        </Routes>
      </main>
    </>
  );
}
