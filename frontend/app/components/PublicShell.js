// Wrapper for the static public marketing pages (about, how-to-use, contact):
// the shared dark background, nav, a constrained content column, and footer.

import PublicNav from "./PublicNav";
import PublicFooter from "./PublicFooter";

export default function PublicShell({ children }) {
  return (
    <main className="lp">
      <div className="lp-bg" aria-hidden="true" />
      <PublicNav />
      <div className="lp-doc">{children}</div>
      <PublicFooter />
    </main>
  );
}
