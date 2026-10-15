import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity, BarChart3, BookOpen, ChevronLeft, CircleDollarSign,
  FileText, LayoutDashboard, Search, Settings2, ShieldCheck, ScrollText, Network,
  Users as UsersIcon, MessageSquareText,
} from "lucide-react";
import "./AdminDashboard.css";
import { messages, type Language } from "../i18n";

type AdminStats = {
  total_users: number;
  total_conversations: number;
  total_messages: number;
  total_documents: number;
};
type AdminUser = { id: number; name: string; email: string; role: string };
type UserResponse = { items: AdminUser[]; total: number; limit: number; offset: number };
type AdminDocument = { id: number; filename: string; owner_id: number | null; page_count: number; chunk_count: number };
type DocumentsResponse = { items: AdminDocument[]; total: number };
type MonitoringStatus = { api: boolean; prometheus: boolean; grafana: boolean; prometheus_url: string; grafana_url: string };
type Props = {
  token: string;
  onBack: () => void;
  language: Language;
  onToggleLanguage: () => void;
};

export default function AdminDashboard({ token, onBack, language, onToggleLanguage }: Props) {
  const t = messages[language];
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [error, setError] = useState("");
  const [usersError, setUsersError] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [documentsTotal, setDocumentsTotal] = useState(0);
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState("");
  const [monitoring, setMonitoring] = useState<MonitoringStatus | null>(null);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [monitoringError, setMonitoringError] = useState("");
  const [monitoringRefresh, setMonitoringRefresh] = useState(0);
  const [activeNav, setActiveNav] = useState("overview");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/admin/stats", {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 403 ? t.adminRequired : t.statsError);
        setStats(await response.json());
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t.statsError);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [token, t.adminRequired, t.statsError]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setUsersLoading(true);
      setUsersError("");
      try {
        const params = new URLSearchParams({ search, limit: "100", offset: "0" });
        const response = await fetch(`/api/admin/users?${params}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (!response.ok) throw new Error(t.usersError);
        const data: UserResponse = await response.json();
        setUsers(data.items);
        setUsersTotal(data.total);
      } catch (err) {
        if (!controller.signal.aborted) setUsersError(err instanceof Error ? err.message : t.usersError);
      } finally {
        if (!controller.signal.aborted) setUsersLoading(false);
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [token, search, t.usersError]);

  useEffect(() => {
    if (activeNav !== "documents") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDocumentsLoading(true);
      setDocumentsError("");
      try {
        const params = new URLSearchParams({ search: documentSearch, limit: "100", offset: "0" });
        const response = await fetch(`/api/admin/documents?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error(t.documentsLoadError);
        const data: DocumentsResponse = await response.json();
        setDocuments(data.items);
        setDocumentsTotal(data.total);
      } catch (err) {
        if (!controller.signal.aborted) setDocumentsError(err instanceof Error ? err.message : t.documentsLoadError);
      } finally {
        if (!controller.signal.aborted) setDocumentsLoading(false);
      }
    }, 160);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeNav, token, documentSearch, t.documentsLoadError]);

  useEffect(() => {
    if (activeNav !== "monitoring" && activeNav !== "settings") return;
    const controller = new AbortController();
    async function loadMonitoring() {
      setMonitoringLoading(true);
      setMonitoringError("");
      try {
        const response = await fetch("/api/admin/monitoring/status", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error(t.monitoringError);
        setMonitoring(await response.json());
      } catch (err) {
        if (!controller.signal.aborted) setMonitoringError(err instanceof Error ? err.message : t.monitoringError);
      } finally {
        if (!controller.signal.aborted) setMonitoringLoading(false);
      }
    }
    void loadMonitoring();
    return () => controller.abort();
  }, [activeNav, token, t.monitoringError, monitoringRefresh]);

  const cards = useMemo(() => stats ? [
    { label: t.activeUsers, value: stats.total_users, icon: UsersIcon, color: "sage" },
    { label: t.totalConversations, value: stats.total_conversations, icon: MessageSquareText, color: "blue" },
    { label: t.totalMessages, value: stats.total_messages, icon: Activity, color: "amber" },
    { label: t.totalDocuments, value: stats.total_documents, icon: FileText, color: "violet" },
  ] : [], [stats, t]);

  const chartItems = [
    { label: t.userActivity, value: stats?.total_users ?? 0, icon: UsersIcon },
    { label: t.conversationActivity, value: stats?.total_conversations ?? 0, icon: MessageSquareText },
    { label: t.messageActivity, value: stats?.total_messages ?? 0, icon: Activity },
    { label: t.documentActivity, value: stats?.total_documents ?? 0, icon: FileText },
  ];
  const maxValue = Math.max(...chartItems.map((item) => item.value), 1);

  const nav = [
    { id: "overview", label: t.overview, icon: LayoutDashboard, ready: true },
    { id: "users", label: t.usersNav, icon: UsersIcon, ready: true },
    { id: "documents", label: t.documentsPageTitle, icon: FileText, ready: true },
    { id: "conversations", label: t.conversationsPageTitle, icon: MessageSquareText, ready: true },
    { id: "usage", label: t.usageNav, icon: CircleDollarSign, ready: true },
    { id: "monitoring", label: t.monitoringPageTitle, icon: BarChart3, ready: true },
    { id: "logs", label: t.logsPageTitle, icon: ScrollText, ready: true },
    { id: "traces", label: t.tracesPageTitle, icon: Network, ready: true },
    { id: "audit", label: t.auditPageTitle, icon: ShieldCheck, ready: true },
    { id: "settings", label: t.settingsPageTitle, icon: Settings2, ready: true },
  ];

  return (
    <div className="admin-shell" dir={language === "ar" ? "rtl" : "ltr"}>
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div className="admin-brand-icon"><BookOpen size={20} /></div>
          <div><strong>Knowledge AI</strong><span>{t.adminEyebrow}</span></div>
        </div>
        <div className="admin-nav-label">{language === "ar" ? "القائمة" : "MENU"}</div>
        <nav className="admin-nav">
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} title={label} className={`admin-nav-item ${activeNav === id ? "active" : ""}`} onClick={() => setActiveNav(id)}>
              <Icon size={17} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <span className="admin-health"><i />{t.online}</span>
          <button className="admin-back-link" onClick={onBack}><ChevronLeft size={16} />{t.backToChat}</button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-breadcrumb"><ShieldCheck size={16} />{t.adminTitle}</div>
          <div className="admin-top-actions">
            <button className="language-toggle" type="button" onClick={onToggleLanguage}>{t.language}</button>
            <button className="admin-chat-button" onClick={onBack}><ChevronLeft size={16} />{t.backToChat}</button>
          </div>
        </header>

        <div className="admin-content">
          <section className="admin-welcome" id="overview-section">
            <div><span className="admin-eyebrow">{t.adminEyebrow}</span><h1>{t.adminWelcome}</h1><p>{t.adminDescription}</p></div>
            <div className="admin-welcome-mark"><BarChart3 size={28} /></div>
          </section>

          {activeNav === "overview" && <>
          {loading && <p className="admin-loading">{t.loadingStats}</p>}
          {error && <p className="admin-error">{error}</p>}
          {stats && <section className="admin-stat-grid" aria-label={t.overview}>
            {cards.map(({ label, value, icon: Icon, color }) => <article className="admin-stat-card" key={label}>
              <div className={`admin-stat-icon ${color}`}><Icon size={18} /></div><span>{label}</span>
              <strong>{value.toLocaleString(language === "ar" ? "ar" : "en")}</strong>
            </article>)}
          </section>}

          <section className="admin-panel admin-activity-panel">
            <div className="admin-panel-heading"><div><h2>{t.activityTitle}</h2><p>{t.activitySubtitle}</p></div><span className="panel-period">{language === "ar" ? "الإجمالي" : "ALL TIME"}</span></div>
            <div className="admin-chart">
              {chartItems.map(({ label, value, icon: Icon }, index) => <div className="chart-row" key={label}>
                <div className="chart-label"><Icon size={15} /><span>{label}</span><strong>{value.toLocaleString(language === "ar" ? "ar" : "en")}</strong></div>
                <div className="chart-track"><div className={`chart-bar bar-${index}`} style={{ width: `${value ? Math.max(8, (value / maxValue) * 100) : 0}%` }} /></div>
              </div>)}
            </div>
          </section>
          </>}

          {activeNav === "users" && <section className="admin-panel admin-users-panel" id="users-section">
            <div className="admin-panel-heading users-heading"><div><h2>{t.userListTitle}</h2><p>{t.userListSubtitle}</p></div>
              <div className="admin-table-tools"><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label={t.filterRole}><option value="all">{t.filterRole}</option><option value="admin">{t.filterAdmins}</option><option value="user">{t.filterUsers}</option></select><label className="admin-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.searchUsers} /></label></div>
            </div>
            <div className="admin-table-wrap"><table className="admin-users-table"><thead><tr><th>{t.userId}</th><th>{t.userName}</th><th>{t.userEmail}</th><th>{t.userRole}</th></tr></thead>
              <tbody>{users.filter((user) => roleFilter === "all" || user.role === roleFilter).map((user) => <tr key={user.id}><td className="user-id">#{user.id}</td><td><div className="user-name-cell"><span className="user-avatar">{user.name?.charAt(0).toUpperCase() || "?"}</span><strong>{user.name}</strong></div></td><td className="user-email-cell">{user.email}</td><td><span className={`role-pill ${user.role === "admin" ? "admin" : "user"}`}>{user.role === "admin" ? t.roleAdmin : t.roleUser}</span></td></tr>)}</tbody>
            </table>
              {usersLoading && <p className="admin-table-state">{t.loadingUsers}</p>}
              {!usersLoading && usersError && <p className="admin-table-state admin-error">{usersError}</p>}
              {!usersLoading && !usersError && users.length === 0 && <p className="admin-table-state">{t.noUsers}</p>}
            </div>
            <div className="admin-table-footer">{t.showing} {users.length.toLocaleString(language === "ar" ? "ar" : "en")} {t.of} {usersTotal.toLocaleString(language === "ar" ? "ar" : "en")}</div>
          </section>}

          {activeNav === "documents" && <section className="admin-panel admin-users-panel">
            <div className="admin-panel-heading users-heading"><div><h2>{t.documentsPageTitle}</h2><p>{t.documentsPageDesc}</p></div><label className="admin-search"><Search size={16} /><input value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder={t.searchDocuments} /></label></div>
            <div className="admin-table-wrap"><table className="admin-users-table"><thead><tr><th>{t.userId}</th><th>{t.filename}</th><th>{t.owner}</th><th>{t.pagesCount}</th><th>{t.chunksCount}</th></tr></thead>
              <tbody>{documents.map((doc) => <tr key={doc.id}><td className="user-id">#{doc.id}</td><td className="document-name-cell"><FileText size={15} />{doc.filename}</td><td>{doc.owner_id ? `#${doc.owner_id}` : "—"}</td><td>{doc.page_count}</td><td>{doc.chunk_count}</td></tr>)}</tbody></table>
              {documentsLoading && <p className="admin-table-state">{t.loadingDocuments}</p>}{!documentsLoading && documentsError && <p className="admin-table-state admin-error">{documentsError}</p>}{!documentsLoading && !documentsError && documents.length === 0 && <p className="admin-table-state">{t.noDocumentsAdmin}</p>}
            </div><div className="admin-table-footer">{t.showing} {documents.length.toLocaleString(language === "ar" ? "ar" : "en")} {t.of} {documentsTotal.toLocaleString(language === "ar" ? "ar" : "en")}</div>
          </section>}

          {activeNav === "conversations" && <section className="admin-section-page"><div className="admin-section-heading"><span className="admin-eyebrow">{t.adminEyebrow}</span><h1>{t.conversationsPageTitle}</h1><p>{t.conversationsPageDesc}</p></div><div className="admin-stat-grid"><article className="admin-stat-card"><div className="admin-stat-icon blue"><MessageSquareText size={18} /></div><span>{t.totalConversations}</span><strong>{(stats?.total_conversations ?? 0).toLocaleString(language === "ar" ? "ar" : "en")}</strong></article><article className="admin-stat-card"><div className="admin-stat-icon amber"><Activity size={18} /></div><span>{t.avgMessages}</span><strong>{stats?.total_conversations ? (stats.total_messages / stats.total_conversations).toFixed(1) : "0"}</strong></article></div><div className="admin-note-card"><ShieldCheck size={18} /><span>{t.privateContentNote}</span></div></section>}

          {activeNav === "usage" && <section className="admin-section-page"><div className="admin-section-heading"><span className="admin-eyebrow">{t.adminEyebrow}</span><h1>{t.usagePageTitle}</h1><p>{t.usagePageDesc}</p></div><div className="admin-empty-card"><CircleDollarSign size={25} /><h2>{t.usagePageTitle}</h2><p>{t.usageUnavailable}</p></div></section>}

          {activeNav === "monitoring" && <section className="admin-section-page"><div className="admin-section-heading"><span className="admin-eyebrow">{t.adminEyebrow}</span><h1>{t.monitoringPageTitle}</h1><p>{t.monitoringPageDesc}</p></div><div className="monitoring-actions"><button className="admin-refresh-button" onClick={() => setMonitoringRefresh((value) => value + 1)}>{t.refreshStatus}</button><a href={monitoring?.grafana_url || "http://localhost:3000"} target="_blank" rel="noreferrer">{t.openGrafana}</a><a href={monitoring?.prometheus_url || "http://localhost:9090"} target="_blank" rel="noreferrer">{t.openPrometheus}</a></div>{monitoringLoading && <p className="admin-loading">{t.loadingStats}</p>}{monitoringError && <p className="admin-error">{monitoringError}</p>}{monitoring && <div className="monitoring-status-grid">{[[t.apiService, monitoring.api], [t.prometheusService, monitoring.prometheus], [t.grafanaService, monitoring.grafana]].map(([label, up]) => <article className="monitoring-status-card" key={String(label)}><span className={`monitoring-status-dot ${up ? "up" : "down"}`} /><div><strong>{label}</strong><small>{up ? t.available : t.unavailable}</small></div></article>)}</div>}</section>}

          {activeNav === "logs" && <UnavailableSection title={t.logsPageTitle} text={t.integrationUnavailable} icon={<ScrollText size={25} />} />}
          {activeNav === "traces" && <UnavailableSection title={t.tracesPageTitle} text={t.integrationUnavailable} icon={<Network size={25} />} />}
          {activeNav === "audit" && <UnavailableSection title={t.auditPageTitle} text={t.integrationUnavailable} icon={<ShieldCheck size={25} />} />}
          {activeNav === "settings" && <section className="admin-section-page"><div className="admin-section-heading"><span className="admin-eyebrow">{t.adminEyebrow}</span><h1>{t.settingsPageTitle}</h1><p>{t.settingsPageDesc}</p></div>{monitoring && <div className="settings-list"><div><span>{t.prometheusService}</span><code>{monitoring.prometheus_url}</code></div><div><span>{t.grafanaService}</span><code>{monitoring.grafana_url}</code></div></div>}{monitoringLoading && <p className="admin-loading">{t.loadingStats}</p>}{monitoringError && <p className="admin-error">{monitoringError}</p>}</section>}
          <footer className="admin-footer">Knowledge AI · {t.adminEyebrow}</footer>
        </div>
      </main>
    </div>
  );
}

function UnavailableSection({ title, text, icon }: { title: string; text: string; icon: ReactNode }) {
  return <section className="admin-section-page"><div className="admin-section-heading"><span className="admin-eyebrow">Knowledge AI</span><h1>{title}</h1></div><div className="admin-empty-card"><div className="empty-card-icon">{icon}</div><p>{text}</p></div></section>;
}
