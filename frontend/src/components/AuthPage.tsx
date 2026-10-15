import { useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { login, register, getCurrentUser } from "../services/auth";
import type { User } from "../services/auth";
import { messages, type Language } from "../i18n";

type AuthPageProps = {
  onSuccess: (user: User, token: string) => void;
  language: Language;
  onToggleLanguage: () => void;
};

export default function AuthPage({ onSuccess, language, onToggleLanguage }: AuthPageProps) {
  const t = messages[language];
  const rtl = language === "ar";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");

    try {
      if (mode === "register") {
        await register(name, email, password);
      }

      const result = await login(email, password);
      const user = await getCurrentUser(result.access_token);

      onSuccess(user, result.access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.authError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page" dir={rtl ? "rtl" : "ltr"}>
      <button className="language-toggle auth-language-toggle" type="button" onClick={onToggleLanguage}>{t.language}</button>
      <section className="auth-showcase">
        <div className="auth-showcase-brand"><span className="auth-showcase-icon"><BookOpen size={19} /></span><span>Knowledge AI</span></div>
        <div className="auth-showcase-content"><span>{language === "ar" ? "من مستنداتك إلى معرفة واضحة" : "From documents to clear understanding"}</span><h2>{language === "ar" ? "كل فكرة مهمة،" : "Every important idea,"}<br />{language === "ar" ? "أقرب للفهم." : "closer to understanding."}</h2><p>{language === "ar" ? "ارفع ملفاتك، اسأل بلغتك، واكتشف الإجابات والأفكار والأرقام مع مصادرها." : "Upload your files, ask in your language, and explore answers, insights, and figures with their sources."}</p></div>
        <div className="auth-showcase-foot"><ShieldCheck size={15} />{language === "ar" ? "إجابات ضمن مستنداتك" : "Answers grounded in your documents"}</div>
      </section>
      <div className="auth-card">
        <div className="auth-logo">
          <BookOpen size={24} />
        </div>

        <div className="auth-heading">
          <span className="auth-eyebrow">
            <Sparkles size={14} /> KNOWLEDGE AI
          </span>

          <h1>{mode === "login" ? t.welcomeLogin : t.createAccount}</h1>

          <p>
            {mode === "login"
              ? t.loginText
              : t.registerText}
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <label>
              {t.fullName}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={100}
                required
                placeholder={t.namePlaceholder}
              />
            </label>
          )}

          <label>
            {t.email}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>

          <label>
            {t.password}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              placeholder={t.passwordPlaceholder}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? (
              <Loader2 size={18} className="spin" />
            ) : mode === "login" ? (
              t.login
            ) : (
              t.register
            )}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login"
            ? t.noAccount
            : t.hasAccount}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
          >
            {mode === "login" ? t.register : t.signIn}
          </button>
        </p>
      </div>
    </div>
  );
}
