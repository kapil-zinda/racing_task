import PublicShell from "../components/PublicShell";
import ContactForm from "../components/ContactForm";

export const metadata = {
  title: "Contact",
  description: "Get in touch with the Dias team — share feedback or ask a question.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <PublicShell>
      <div className="lp-doc-head">
        <span className="lp-doc-eyebrow">Contact</span>
        <h1>Feedback or a question?</h1>
        <p className="lp-doc-lede">
          Tell us what&apos;s working, what isn&apos;t, or what would help your preparation.
          Send a message and we&apos;ll get back to you by email.
        </p>
      </div>
      <ContactForm />
    </PublicShell>
  );
}
