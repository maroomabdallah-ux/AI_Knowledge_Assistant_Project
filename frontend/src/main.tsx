import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import AuthPage from "./components/AuthPage";
import AdminDashboard from "./components/AdminDashboard";

import { getCurrentUser, SessionExpiredError, type User } from "./services/auth";
import { messages, type Language } from "./i18n";

import "./style.css";

function Root() {
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem("knowledge-ai-language") === "en" ? "en" : "ar",
  );
  const t = messages[language];
  const [currentPage, setCurrentPage] = useState<"chat" | "admin">("chat");

  const [role, setRole] = useState<string>("user");

  const [session, setSession] = useState<{
    user: User;
    token: string;
  } | null>(() => {
    const savedToken = localStorage.getItem("knowledge-ai-token");
    const savedUser = localStorage.getItem("knowledge-ai-user");
    if (!savedToken || !savedUser) return null;
    try {
      return { token: savedToken, user: JSON.parse(savedUser) as User };
    } catch {
      localStorage.removeItem("knowledge-ai-token");
      localStorage.removeItem("knowledge-ai-user");
      return null;
    }
  });

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    localStorage.setItem("knowledge-ai-language", language);
  }, [language]);

  useEffect(() => {
    if (!session) {
      localStorage.removeItem("knowledge-ai-token");
      localStorage.removeItem("knowledge-ai-user");
      return;
    }
    localStorage.setItem("knowledge-ai-token", session.token);
    localStorage.setItem("knowledge-ai-user", JSON.stringify(session.user));
  }, [session]);

  useEffect(() => {
    if (!session) {
      setRole("user");
      setCurrentPage("chat");
      return;
    }

    const controller = new AbortController();
    const token = session.token;

    setRole("user");
    setCurrentPage("chat");

    async function loadProfile() {
      try {
        const profile = await getCurrentUser(token);

        if (!controller.signal.aborted) {
          setRole(profile.role ?? "user");
        }
      } catch (error) {
        if (!controller.signal.aborted && error instanceof SessionExpiredError) {
          localStorage.removeItem("knowledge-ai-token");
          localStorage.removeItem("knowledge-ai-user");
          setSession(null);
        }
      }
    }

    void loadProfile();

    return () => controller.abort();
  }, [session]);

  if (!session) {
    return <AuthPage language={language} onToggleLanguage={() => setLanguage(language === "ar" ? "en" : "ar")} onSuccess={(user, token) => setSession({ user, token })} />;
  }

  if (currentPage === "admin" && role === "admin") {
    return (
      <AdminDashboard
        token={session.token}
        language={language}
        onToggleLanguage={() => setLanguage(language === "ar" ? "en" : "ar")}
        onBack={() => setCurrentPage("chat")}
      />
    );
  }

  return (
    <App
      token={session.token}
      language={language}
      onToggleLanguage={() => setLanguage(language === "ar" ? "en" : "ar")}
      user={session.user}
      isAdmin={role === "admin"}
      onOpenAdmin={() => {
        if (role === "admin") {
          setCurrentPage("admin");
        }
      }}
      onLogout={() => {
        setSession(null);
        setRole("user");
        setCurrentPage("chat");
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
