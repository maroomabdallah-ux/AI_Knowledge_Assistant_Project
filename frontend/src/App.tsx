import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { messages as translations, type Language } from "./i18n";

import {
  ArrowUp,
  BookOpen,
  CheckCircle2,
  FileText,
  Loader2,
  Menu,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Sparkles,
  UploadCloud,
  ShieldCheck,
} from "lucide-react";

type Source = {
  filename: string;
  page_number: number | null;
  similarity: number;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  document_id?: number | null;
  a2ui?: A2UISurfaceMessage[];
  interactive?: boolean;
};

type A2UIComponent =
  | { id: string; component: "Card"; child: string }
  | { id: string; component: "Column"; children: string[] }
  | { id: string; component: "Text"; text: string }
  | { id: string; component: "Progress"; value: number; label: string }
  | { id: string; component: "Quiz"; questions: { question: string; options: string[]; correctIndex: number; explanation: string }[] }
  | { id: string; component: "Chart"; chartType: "bar"; unit: string; points: { label: string; value: number }[] }
  | { id: string; component: "Button"; child: string; action: { event: { name: "ask_document_question"; userMessage?: string; context: { question: string } } } };
type A2UISurfaceMessage = {
  version: "v1.0";
  createSurface: { surfaceId: string; catalogId: string; components: A2UIComponent[] };
};

type DocumentInfo = {
  id: number;
  name: string;
  pages: number;
  characters: number;
};
type Conversation = {
  id: number;
  user_id: number;
  title: string;
  document_id: number | null;
  document_name?: string | null;
};
type JourneyProgress = { completed: string[]; active: string | null };

type AppProps = {
  token: string;
  user: {
    id: number;
    name: string;
    email: string;
  };
  isAdmin: boolean;
  onOpenAdmin: () => void;
  onLogout: () => void;
  language: Language;
  onToggleLanguage: () => void;
};

function formatAssistantContent(content: string) {
  return content
    .replace(/\r\n?/g, "\n")
    .replace(/([^\n])\s+((?:[0-9]{1,2}|[٠-٩]{1,2})\.)\s+/g, "$1\n\n$2 ")
    .replace(/\n(?=((?:[0-9]{1,2}|[٠-٩]{1,2})\.)\s)/g, "\n\n")
    .trim();
}

export default function App({
  token,
  user,
  isAdmin,
  onOpenAdmin,
  onLogout,
  language,
  onToggleLanguage,
}: AppProps) {
  const t = translations[language];
  const rtl = language === "ar";
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: translations[language].noFile,
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [activeChartPoints, setActiveChartPoints] = useState<Record<string, number>>({});
  const journeyStorageKey = `knowledge-ai-reading-journey:${user.id}`;
  const [journeyByDocument, setJourneyByDocument] = useState<Record<string, JourneyProgress>>(() => {
    try { return JSON.parse(localStorage.getItem(journeyStorageKey) || "{}"); } catch { return {}; }
  });
  const pendingJourneyStage = useRef<string | null>(null);
  useEffect(() => { localStorage.setItem(journeyStorageKey, JSON.stringify(journeyByDocument)); }, [journeyByDocument, journeyStorageKey]);
  function scrollToBottom() {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
      });
    }, 100);
  }

  async function loadConversations() {
    try {
      setHistoryError("");

      const response = await fetch("/api/conversations", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || t.loadConversationsError);
      }

      const data: Conversation[] = await response.json();
      setConversations(data);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : t.loadHistoryError);
    }
  }

  async function openConversation(id: number) {
    if (loading || historyLoading) return;

    setHistoryLoading(true);
    setHistoryError("");

    try {
      const response = await fetch(`/api/conversations/${id}/messages`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(t.loadMessagesError);
      }

      const data: Message[] = await response.json();

      setConversationId(id);
      const conversation = conversations.find((item) => item.id === id);
      const linkedDocumentId = conversation?.document_id ?? data[0]?.document_id ?? null;
      setSelectedDocumentId(linkedDocumentId);
      setMessages(
        data.length > 0
          ? data.map((message) => ({ ...message, a2ui: parseA2UISurfaces(message.a2ui) }))
          : [
              {
                role: "assistant",
                content: t.emptyConversation,
              },
            ],
      );

      setInput("");
      scrollToBottom();
    } catch {
      setHistoryError(t.openHistoryError);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    void loadConversations();
    fetch("/api/documents", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: DocumentInfo[]) => setDocuments(data))
      .catch(() => setUploadError(t.documentListError));
  }, [token, language]);

  async function send() {
    const question = input.trim();
    if (!question || loading) return;
    if (!selectedDocumentId) {
      setMessages((prev) => [...prev, { role: "assistant", content: t.selectDocFirst }]);
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: question }]);

    setInput("");
    setLoading(true);
    scrollToBottom();

    try {
      let activeConversationId = conversationId;

      // Create a conversation when sending the first message
      if (activeConversationId === null) {
        const createResponse = await fetch("/api/conversations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: question.slice(0, 60),
          }),
        });

        if (!createResponse.ok) {
          throw new Error(t.createConversationError);
        }

        const conversation = await createResponse.json();

        activeConversationId = conversation.id;
        setConversationId(activeConversationId);
        void loadConversations();
      }

      // Send the message to the existing conversation
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: question,
          conversation_id: activeConversationId,
          document_id: selectedDocumentId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || t.sendError);
      }

      const data = await response.json();

      const a2ui = parseA2UISurfaces(data.a2ui);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          sources: data.sources ?? [],
          a2ui,
          interactive: a2ui.length === 0,
        },
      ]);
      if (pendingJourneyStage.current && selectedDocumentId !== null) {
        const completedStage = pendingJourneyStage.current;
        const documentKey = String(selectedDocumentId);
        const quizStage = completedStage === "practice" && a2ui.some((surface) => surface.createSurface.components.some((component) => component.component === "Quiz"));
        if (completedStage !== "practice" && !quizStage && (data.sources?.length ?? 0) > 0) {
          completeJourneyStage(completedStage, selectedDocumentId);
        } else if (!quizStage) {
          setJourneyByDocument((current) => ({ ...current, [documentKey]: { completed: current[documentKey]?.completed ?? [], active: null } }));
        }
      }
      pendingJourneyStage.current = null;
    } catch (error) {
      pendingJourneyStage.current = null;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : t.genericError,
        },
      ]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  function parseA2UISurfaces(value: unknown): A2UISurfaceMessage[] {
    if (!Array.isArray(value)) return [];
    const parsed: A2UISurfaceMessage[] = [];
    for (const raw of value.slice(0, 8)) {
      if (!raw || typeof raw !== "object") continue;
      const envelope = raw as Record<string, unknown>;
      const surface = envelope.createSurface as Record<string, unknown> | undefined;
      if (envelope.version !== "v1.0" || !surface || typeof surface !== "object" ||
          typeof surface.surfaceId !== "string" ||
          surface.catalogId !== "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json" ||
          !Array.isArray(surface.components) || surface.components.length < 1 || surface.components.length > 24) continue;
      const components: A2UIComponent[] = [];
      let valid = true;
      for (const item of surface.components) {
        if (!item || typeof item !== "object") { valid = false; break; }
        const component = item as Record<string, unknown>;
        if (typeof component.id !== "string" || component.id.length > 64) { valid = false; break; }
        if (component.component === "Card" && typeof component.child === "string") {
          components.push({ id: component.id, component: "Card", child: component.child });
        } else if (component.component === "Column" && Array.isArray(component.children) && component.children.every((child) => typeof child === "string")) {
          components.push({ id: component.id, component: "Column", children: component.children.slice(0, 12) as string[] });
        } else if (component.component === "Text" && typeof component.text === "string" && component.text.length <= 400) {
          components.push({ id: component.id, component: "Text", text: component.text });
        } else if (component.component === "Progress" && Number.isInteger(component.value) && typeof component.label === "string") {
          components.push({ id: component.id, component: "Progress", value: Math.max(0, Math.min(100, component.value as number)), label: component.label.slice(0, 20) });
        } else if (component.component === "Quiz" && Array.isArray(component.questions) && component.questions.length <= 3) {
          const questions = component.questions.slice(0, 3).flatMap((rawQuestion) => {
            if (!rawQuestion || typeof rawQuestion !== "object") return [];
            const q = rawQuestion as Record<string, unknown>;
            if (typeof q.question !== "string" || q.question.length > 240 || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4 || !q.options.every((option) => typeof option === "string" && option.length <= 140) || !Number.isInteger(q.correctIndex) || (q.correctIndex as number) < 0 || (q.correctIndex as number) >= q.options.length || typeof q.explanation !== "string" || q.explanation.length > 320) return [];
            return [{ question: q.question, options: q.options as string[], correctIndex: q.correctIndex as number, explanation: q.explanation }];
          });
          if (!questions.length) { valid = false; break; }
          components.push({ id: component.id, component: "Quiz", questions });
        } else if (component.component === "Chart" && component.chartType === "bar" && typeof component.unit === "string" && component.unit.length <= 24 && Array.isArray(component.points) && component.points.length >= 1 && component.points.length <= 8) {
          const points = component.points.flatMap((rawPoint) => {
            if (!rawPoint || typeof rawPoint !== "object") return [];
            const point = rawPoint as Record<string, unknown>;
            if (typeof point.label !== "string" || point.label.length > 50 || typeof point.value !== "number" || !Number.isFinite(point.value)) return [];
            return [{ label: point.label, value: Math.max(0, Math.min(point.value, 1_000_000_000)) }];
          });
          if (!points.length) { valid = false; break; }
          components.push({ id: component.id, component: "Chart", chartType: "bar", unit: component.unit, points });
        } else if (component.component === "Button" && typeof component.child === "string") {
          const action = component.action as Record<string, unknown> | undefined;
          const event = action?.event as Record<string, unknown> | undefined;
          const context = event?.context as Record<string, unknown> | undefined;
          const question = context?.question;
          if (event?.name !== "ask_document_question" || typeof question !== "string" || question.length > 400) { valid = false; break; }
          components.push({ id: component.id, component: "Button", child: component.child, action: { event: { name: "ask_document_question", userMessage: typeof event.userMessage === "string" ? event.userMessage.slice(0, 400) : undefined, context: { question } } } });
        } else { valid = false; break; }
      }
      const ids = new Set(components.map((component) => component.id));
      if (new Set(components.map((component) => component.id)).size !== components.length || !ids.has("root")) valid = false;
      for (const component of components) {
        const references = component.component === "Card" || component.component === "Button" ? [component.child] : component.component === "Column" ? component.children : [];
        if (references.some((id) => !ids.has(id))) valid = false;
      }
      if (valid) parsed.push({ version: "v1.0", createSurface: { surfaceId: surface.surfaceId.slice(0, 100), catalogId: surface.catalogId as string, components } });
    }
    return parsed;
  }

  async function sendQuestion(question: string) {
    if (loading || !selectedDocumentId) return;
    setInput(question);
    // Let React commit the controlled input before the shared form handler reads it.
    window.setTimeout(() => document.querySelector<HTMLFormElement>(".composer")?.requestSubmit(), 0);
  }

  function renderA2UISurface(surface: A2UISurfaceMessage) {
    const components = new Map(surface.createSurface.components.map((component) => [component.id, component]));
    const renderNode = (id: string, depth = 0): React.ReactNode => {
      if (depth > 8) return null;
      const component = components.get(id);
      if (!component) return null;
      if (component.component === "Card") {
        return <section key={id} className="a2ui-surface" aria-label={language === "ar" ? "بطاقة تفاعلية من المستند" : "Interactive document card"}>{renderNode(component.child, depth + 1)}</section>;
      }
      if (component.component === "Column") {
        return <div key={id} className="a2ui-card-content">{component.children.map((child) => renderNode(child, depth + 1))}</div>;
      }
      if (component.component === "Text") {
        return /title$/.test(id) ? <h3 key={id}>{component.text}</h3> : <p key={id}>{component.text}</p>;
      }
      if (component.component === "Progress") {
        return <div key={id} className="a2ui-progress"><div className="a2ui-progress-heading"><span>{language === "ar" ? "تغطية الملف" : "Document coverage"}</span><strong>{component.value}%</strong></div><div className="a2ui-progress-track" role="progressbar" aria-label={language === "ar" ? "تغطية الملف" : "Document coverage"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={component.value}><span style={{ width: `${component.value}%` }} /></div></div>;
      }
      if (component.component === "Quiz") {
        const answers = component.questions.map((_, questionIndex) => quizAnswers[`${surface.createSurface.surfaceId}:${id}:${questionIndex}`]);
        const answered = answers.filter((answer) => answer !== undefined).length;
        const score = answers.reduce((total, answer, questionIndex) => total + (answer === component.questions[questionIndex].correctIndex ? 1 : 0), 0);
        return <div className="a2ui-quiz" key={id}>
          {component.questions.map((quizQuestion, questionIndex) => {
            const answerKey = `${surface.createSurface.surfaceId}:${id}:${questionIndex}`;
            const selectedAnswer = quizAnswers[answerKey];
            return <fieldset className="a2ui-quiz-question" key={answerKey}>
              <legend>{quizQuestion.question}</legend>
              <div className="a2ui-quiz-options">{quizQuestion.options.map((option, optionIndex) => <button key={optionIndex} type="button" aria-pressed={selectedAnswer === optionIndex} className={selectedAnswer === optionIndex ? "selected" : ""} onClick={() => { const nextAnswers = { ...quizAnswers, [answerKey]: optionIndex }; setQuizAnswers(nextAnswers); const quizComplete = component.questions.every((_, itemIndex) => nextAnswers[`${surface.createSurface.surfaceId}:${id}:${itemIndex}`] !== undefined); if (quizComplete && currentJourney.active === "practice" && selectedDocumentId !== null) completeJourneyStage("practice", selectedDocumentId); }}>{option}</button>)}</div>
              {selectedAnswer !== undefined && <p className={`a2ui-quiz-feedback ${selectedAnswer === quizQuestion.correctIndex ? "correct" : "incorrect"}`}>{selectedAnswer === quizQuestion.correctIndex ? (language === "ar" ? "إجابة صحيحة" : "Correct") : (language === "ar" ? "حاول مرة أخرى" : "Try again")}{` — ${quizQuestion.explanation}`}</p>}
            </fieldset>;
          })}
          {answered === component.questions.length && <div className="a2ui-quiz-score">{language === "ar" ? `نتيجتك: ${score} من ${component.questions.length}` : `Your score: ${score} of ${component.questions.length}`}</div>}
        </div>;
      }
      if (component.component === "Chart") {
        const maxValue = Math.max(...component.points.map((point) => point.value), 1);
        const activePoint = activeChartPoints[`${surface.createSurface.surfaceId}:${id}`];
        return <div className="a2ui-chart" key={id} role="img" aria-label={language === "ar" ? "رسم أعمدة من أرقام الملف" : "Bar chart from document figures"}>
          {activePoint !== undefined && <div className="a2ui-chart-selection"><strong>{component.points[activePoint].label}</strong><span>{component.points[activePoint].value.toLocaleString()} {component.unit}</span></div>}
          <div className="a2ui-chart-bars">{component.points.map((point, index) => <button className={`a2ui-chart-bar-item ${activePoint === index ? "active" : ""}`} type="button" key={`${point.label}-${index}`} title={`${point.label}: ${point.value.toLocaleString()} ${component.unit}`} aria-pressed={activePoint === index} onClick={() => setActiveChartPoints((current) => ({ ...current, [`${surface.createSurface.surfaceId}:${id}`]: index }))}>
            <span className="a2ui-chart-value">{point.value.toLocaleString()}{component.unit ? ` ${component.unit}` : ""}</span>
            <span className="a2ui-chart-track"><span style={{ height: `${Math.max(4, (point.value / maxValue) * 100)}%` }} /></span>
            <span className="a2ui-chart-label">{point.label}</span>
          </button>)}</div>
        </div>;
      }
      const label = components.get(component.child);
      const text = label?.component === "Text" ? label.text : (language === "ar" ? "اسأل عن هذا" : "Ask about this");
      return <button key={id} type="button" onClick={() => void sendQuestion(component.action.event.context.question)} disabled={loading || !selectedDocumentId}>{text}</button>;
    };
    return <div className="a2ui-rendered-surface" key={surface.createSurface.surfaceId}>{renderNode("root")}</div>;
  }

  const starterCards = language === "ar"
    ? [
        { title: "ملخص الملف", summary: "استخرج الفكرة العامة وأهم ما يقدمه المستند.", label: "لخّص الملف", question: "لخّص محتوى هذا الملف مع ذكر أهم النقاط." },
        { title: "أهم النقاط", summary: "راجع أبرز المعلومات التي يذكرها الملف.", label: "اعرض النقاط", question: "ما أهم النقاط المذكورة في هذا الملف؟" },
        { title: "موضوع الملف", summary: "اكتشف الموضوع الرئيسي للمستند.", label: "اسأل عن الموضوع", question: "ما الموضوع الرئيسي لهذا الملف؟" },
      ]
    : [
        { title: "Document summary", summary: "Get the main idea and what the document covers.", label: "Summarize", question: "Summarize this document and list its key points." },
        { title: "Key points", summary: "Review the most important information in the file.", label: "Show key points", question: "What are the key points in this document?" },
        { title: "Main topic", summary: "Find the document's central subject.", label: "Ask about topic", question: "What is the main topic of this document?" },
      ];

  const activeDocument = documents.find((doc) => doc.id === selectedDocumentId) ?? null;
  const journeySteps = language === "ar"
    ? [{ id:"discover",label:"اكتشف",detail:"الفكرة العامة",question:"لخّص الفكرة الرئيسية والهدف من هذا الملف."},{id:"explore",label:"استكشف",detail:"الأفكار الأساسية",question:"استخرج أهم الأفكار والمحاور المذكورة في الملف."},{id:"examine",label:"تحقق",detail:"الأدلة والأرقام",question:"ما الأدلة والأرقام التي يدعم بها الملف أفكاره؟"},{id:"practice",label:"اختبر",detail:"تأكد من فهمك",question:"أنشئ اختبارًا قصيرًا من 3 أسئلة حول محتوى الملف."}]
    : [{id:"discover",label:"Discover",detail:"The big picture",question:"Summarize the main idea and purpose of this document."},{id:"explore",label:"Explore",detail:"Key ideas",question:"Extract the most important ideas and themes in the document."},{id:"examine",label:"Examine",detail:"Evidence & figures",question:"What evidence and figures support the document's main ideas?"},{id:"practice",label:"Practice",detail:"Check understanding",question:"Create a short 3-question quiz based on this document."}];
  const currentJourney = selectedDocumentId === null ? { completed: [], active: null } : journeyByDocument[String(selectedDocumentId)] ?? { completed: [], active: null };
  const journeyCompletion = Math.round((currentJourney.completed.length / journeySteps.length) * 100);
  function startJourneyStage(stageId: string, question: string) {
    if (!selectedDocumentId || loading) return;
    pendingJourneyStage.current = stageId;
    const documentKey = String(selectedDocumentId);
    setJourneyByDocument((current) => ({ ...current, [documentKey]: { completed: current[documentKey]?.completed ?? [], active: stageId } }));
    void sendQuestion(question);
  }
  function completeJourneyStage(stageId: string, documentId: number) {
    const documentKey = String(documentId);
    setJourneyByDocument((current) => {
      const previous = current[documentKey] ?? { completed: [], active: null };
      return { ...current, [documentKey]: { active: stageId, completed: previous.completed.includes(stageId) ? previous.completed : [...previous.completed, stageId] } };
    });
  }
  const latestInsightMessage = [...messages].reverse().find((message) => message.role === "assistant" && message.a2ui?.length);
  const latestSourceCount = latestInsightMessage?.sources ? new Set(latestInsightMessage.sources.map((source) => `${source.filename}:${source.page_number}`)).size : 0;

  async function uploadPDF(file: File) {
    setUploading(true);
    setUploadError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 180_000);
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);

        throw new Error(
          errorData?.detail || `Upload failed: ${response.status}`,
        );
      }

      const data = await response.json();

      setDocuments((prev) => [
        ...prev,
        {
          id: data.document_id,
          name: data.filename,
          pages: data.pages,
          characters: data.characters,
        },
      ]);
      setSelectedDocumentId(data.document_id);
      setConversationId(null);
      setMessages([{ role: "assistant", content: t.selectedDoc(data.filename) }]);
    } catch (error) {
      setUploadError(
        error instanceof DOMException && error.name === "AbortError"
          ? (language === "ar" ? "استغرق تجهيز الملف أكثر من 3 دقائق. تحقق من إعداد OCR وبيانات Tesseract العربية ثم أعد المحاولة." : "Document processing exceeded 3 minutes. Check OCR and Arabic Tesseract data, then try again.")
          : error instanceof Error ? error.message : t.uploadError,
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }
  function newChat() {
    if (loading) return;

    setConversationId(null);

    setMessages([
      {
        role: "assistant",
        content: t.newConversation,
      },
    ]);

    setInput("");
  }

  return (
    <div className="app-shell" dir={rtl ? "rtl" : "ltr"}>
      {/* Sidebar */}

      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-icon">
              <BookOpen size={20} />
            </div>
            <div>
              <strong>Knowledge AI</strong>
              <span>{language === "ar" ? "مساحة معرفتك" : "Your knowledge space"}</span>
            </div>
          </div>

          {isAdmin && (
            <button
              type="button"
              className="admin-nav-button"
              onClick={onOpenAdmin}
            >
              {t.admin}
            </button>
          )}

          <button
            className="icon-button sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label={t.closeSidebar}
          >
            <PanelLeftClose size={19} />
          </button>
        </div>

        <button className="new-chat-btn" onClick={newChat}>
          <Plus size={17} />
          {t.newChat}
        </button>

        <div className="sidebar-section">
          <div className="section-heading">
            <span>{t.history}</span>
            <span className="document-count">{conversations.length}</span>
          </div>

          {historyError && <p className="upload-error">{historyError}</p>}

          <div className="chat-history-list">
            {conversations.length === 0 ? (
              <p className="empty-documents">{t.noConversations}</p>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`history-item ${
                    conversationId === conversation.id ? "active" : ""
                  }`}
                  onClick={() => void openConversation(conversation.id)}
                  disabled={loading || historyLoading}
                >
                  <MessageSquare size={16} />
                  <span>{conversation.title}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-heading">
            <span>{t.documents}</span>
            <span className="document-count">{documents.length}</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadPDF(file);
            }}
          />

          <button
            className="upload-card"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <div className="upload-icon">
              {uploading ? (
                <Loader2 size={22} className="spin" />
              ) : (
                <UploadCloud size={22} />
              )}
            </div>
            <strong>
              {uploading ? t.uploading : t.upload}
            </strong>
            <span>{t.uploadHint}</span>
            <small>{t.pdfLimit}</small>
          </button>

          {uploadError && <p className="upload-error">{uploadError}</p>}

          <div className="document-list">
            {documents.length === 0 ? (
              <p className="empty-documents">{t.noDocuments}</p>
            ) : (
              documents.map((doc, index) => (
                <button type="button" className={`document-item ${selectedDocumentId === doc.id ? "selected" : ""}`} key={doc.id} onClick={() => { setSelectedDocumentId(doc.id); setConversationId(null); setMessages([{ role: "assistant", content: t.selectedDoc(doc.name) }]); }}>
                  <div className="document-icon">
                    <FileText size={17} />
                  </div>
                  <div className="document-info">
                    <strong title={doc.name}>{doc.name}</strong>
                    <span>
                      {doc.pages} {doc.pages === 1 ? t.page : t.pages}
                    </span>
                  </div>
                  {selectedDocumentId === doc.id ? <CheckCircle2 size={16} className="success-icon" /> : <span className="select-label">{t.choose}</span>}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="status-dot" />
          <span>{t.scopeStatus}</span>
        </div>

        <div className="sidebar-account">
          <div className="account-avatar">
            {user.name.charAt(0).toUpperCase()}
          </div>

          <div className="account-details">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>

          <button
            type="button"
            className="logout-button"
            onClick={onLogout}
            title={t.logoutTitle}
          >
            {t.logout}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <button
                className="icon-button"
                onClick={() => setSidebarOpen(true)}
                aria-label={t.openSidebar}
              >
                <Menu size={20} />
              </button>
            )}

            <div className="breadcrumb">
              <MessageSquare size={17} />
              <div className="breadcrumb-copy"><span>{t.breadcrumb}</span>{selectedDocumentId && <small>{activeDocument?.name ?? (language === "ar" ? "ملف محدد" : "Selected document")}</small>}</div>
            </div>
          </div>

          <div className="topbar-badge">
            <Sparkles size={14} />
            <button className="language-toggle" type="button" onClick={onToggleLanguage}>{t.language}</button>
            <ShieldCheck size={14} /> {t.scopeBadge}
          </div>
        </header>

        <div className="product-workspace">
        <section className="copilot-workspace">
        <div className="copilot-heading"><div className="copilot-avatar"><Sparkles size={16} /></div><div><strong>{language === "ar" ? "مساعد المستند" : "Document copilot"}</strong><span><i />{language === "ar" ? "يقرأ الملف المحدد" : "Grounded in selected file"}</span></div><button type="button" className="icon-button" title={t.newChat} onClick={newChat}><Plus size={16} /></button></div>
        <div className="conversation">
          <div className="conversation-inner">
            {!selectedDocumentId && <div className="welcome-section">
              <div className="welcome-icon">
                <Sparkles size={25} />
              </div>
              <span className="welcome-kicker">{language === "ar" ? "مساحة معرفة خاصة بملفك" : "YOUR DOCUMENT KNOWLEDGE SPACE"}</span>
              <h1>{selectedDocumentId ? (language === "ar" ? "اكتشف ما وراء صفحات ملفك" : "Explore the ideas inside your document") : t.welcomeTitle}</h1>
              <p>{selectedDocumentId ? (language === "ar" ? "اسأل، قارن، اختبر فهمك، وشاهد الأرقام المهمة — مع إجابات موثقة من الملف." : "Ask, compare, test your understanding, and uncover key figures — with answers grounded in your file.") : t.welcomeText}</p>
            </div>}

            <div className="messages">
              {messages.map((message, index) => (
                <div key={index} className={`chat-row ${message.role}`}>
                  <div className="avatar">
                    {message.role === "assistant" ? (
                      <Sparkles size={17} />
                    ) : (
                      <span>Y</span>
                    )}
                  </div>

                  <div className="message-content">
                    <span className="message-author">
                      {message.role === "assistant" ? t.assistant : t.you}
                    </span>

                    <div className={`message-bubble ${message.role === "assistant" ? "assistant-response" : ""}`} dir="auto">
                      {message.role === "assistant" ? (
                        <ReactMarkdown>{message.role === "assistant" ? formatAssistantContent(message.content) : message.content}</ReactMarkdown>
                      ) : (
                        message.content
                      )}
                    </div>
                    {message.a2ui && message.a2ui.length > 0 && <button type="button" className="answer-insights-link" onClick={() => document.querySelector(".document-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Sparkles size={13} />{language === "ar" ? "تم تحديث مساحة الاستكشاف" : "Explore panel updated"}<ArrowUp size={12} /></button>}
                    {message.role === "assistant" && message.interactive && !message.a2ui?.length && (
                      <section className="a2ui-surface" aria-label={language === "ar" ? "اقتراحات تفاعلية" : "Interactive suggestions"}>
                        <h3>{language === "ar" ? "تابع الاستكشاف" : "Explore further"}</h3>
                        <p>{language === "ar" ? "اختر بطاقة لإرسال سؤال متابعة عن الملف." : "Select a card to ask a follow-up about the document."}</p>
                        <div className="a2ui-actions">
                          {(language === "ar"
                            ? ["اشرح الإجابة بمزيد من التفصيل", "ما الدليل من الملف؟", "لخّص أهم ما ورد في الإجابة"]
                            : ["Explain the answer in more detail", "What evidence supports this?", "Summarize the key points"]
                          ).map((value) => (
                            <button key={value} type="button" onClick={() => void sendQuestion(value)} disabled={loading || !selectedDocumentId}>{value}</button>
                          ))}
                        </div>
                      </section>
                    )}
                    {message.role === "assistant" &&
                      message.sources &&
                      message.sources.length > 0 && (
                        <div className="message-sources">
                          <div className="sources-title">{t.sources}</div>

                          {message.sources
                            .filter(
                              (source, index, all) =>
                                all.findIndex(
                                  (item) =>
                                    item.filename === source.filename &&
                                    item.page_number === source.page_number,
                                ) === index,
                            )
                            .map((source, index) => (
                              <div className="source-item" key={index}>
                                <FileText size={15} />

                                <span>{source.filename}</span>

                                <span>
                                  {source.page_number !== null
                                    ? language === "ar" ? `صفحة ${source.page_number}` : `Page ${source.page_number}`
                                    : t.unknownPage}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="chat-row assistant">
                  <div className="avatar">
                    <Sparkles size={17} />
                  </div>
                  <div className="message-content">
                    <span className="message-author">{t.assistant}</span>
                    <div className="typing-indicator">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        <div className="composer-area">
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selectedDocumentId ? t.askPlaceholder : t.choosePlaceholder}
              disabled={loading}
            />

            <button
              className="send-button"
              type="submit"
              disabled={!input.trim() || loading || !selectedDocumentId}
              aria-label="Send message"
            >
              {loading ? (
                <Loader2 size={19} className="spin" />
              ) : (
                <ArrowUp size={20} />
              )}
            </button>
          </form>

          <p className="composer-hint">
            {t.hint}
          </p>
        </div>
        </section>

        <aside className="document-workspace" aria-label={language === "ar" ? "لوحة استكشاف المستند" : "Document exploration workspace"}>
          <div className="workspace-toolbar"><div className="workspace-brand"><span>KNOWLEDGE STUDIO</span><small>{language === "ar" ? "مساحة استكشاف المستند" : "DOCUMENT INTELLIGENCE"}</small></div><div className="workspace-toolbar-actions"><button type="button" onClick={() => window.print()}>{language === "ar" ? "حفظ كـ PDF" : "Export PDF"}</button><button type="button" onClick={() => { setQuizAnswers({}); setActiveChartPoints({}); document.querySelector(".document-workspace")?.scrollTo({ top: 0, behavior: "smooth" }); }}>{language === "ar" ? "إعادة ضبط" : "Reset view"}</button></div></div>
          {activeDocument ? <div className="workspace-canvas">
            <section className="workspace-hero"><div className="workspace-hero-shade"/><div className="workspace-hero-content"><span className="workspace-eyebrow">{language === "ar" ? "مساحة معرفة · مستندك" : "KNOWLEDGE SPACE · YOUR DOCUMENT"}</span><h1>{language === "ar" ? "استكشف محتوى مستندك" : "Explore your document"}</h1><p>{activeDocument.name}</p><div className="workspace-tags"><span>{language === "ar" ? "مقيّد بمصادرك" : "SOURCE GROUNDED"}</span><span>{language === "ar" ? "عربي · English" : "ARABIC · ENGLISH"}</span></div></div><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/></section>
            <section className="journey-panel">
              <div className="workspace-section-heading"><div><span>{language === "ar" ? "مسار الاستكشاف" : "YOUR READING JOURNEY"}</span><h2>{language === "ar" ? "من القراءة إلى الفهم" : "From reading to understanding"}</h2></div><small>{language === "ar" ? `${currentJourney.completed.length} من ${journeySteps.length} مراحل مستكشفة` : `${currentJourney.completed.length} of ${journeySteps.length} stages explored`}</small></div>
              <div className="journey-progress-summary"><span>{language === "ar" ? "تقدم الاستكشاف" : "EXPLORATION PROGRESS"}</span><strong>{journeyCompletion}%</strong></div>
              <div className="journey-progress-track" role="progressbar" aria-label={language === "ar" ? "مراحل الملف المستكشفة" : "Document stages explored"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={journeyCompletion}><span style={{width:`${journeyCompletion}%`}}/></div>
              <div className="journey-track">{journeySteps.map((step,index)=>{const isComplete=currentJourney.completed.includes(step.id);const isActive=currentJourney.active===step.id&&!isComplete;return <button className={`journey-step ${isComplete?"completed":""} ${isActive?"active":""}`} type="button" key={step.id} aria-pressed={isActive} onClick={()=>startJourneyStage(step.id,step.question)} disabled={loading}><span className="journey-node">{isComplete?"✓":String(index+1).padStart(2,"0")}</span><strong>{step.label}</strong><small>{step.detail}</small><em>{isComplete?(language==="ar"?"تم الاستكشاف":"Explored"):isActive?(language==="ar"?"جارٍ الاستكشاف":"In progress"):" "}</em></button>})}</div>
            </section>
            <section className="workspace-metrics"><article><span>{language === "ar" ? "صفحات" : "PAGES"}</span><strong>{activeDocument.pages.toLocaleString(language === "ar" ? "ar" : "en")}</strong><small>{language === "ar" ? "تمت فهرستها" : "indexed"}</small></article><article><span>{language === "ar" ? "حجم النص" : "TEXT SIZE"}</span><strong>{activeDocument.characters.toLocaleString(language === "ar" ? "ar" : "en")}</strong><small>{language === "ar" ? "حرف مستخرج" : "characters extracted"}</small></article><article><span>{language === "ar" ? "المراجع" : "REFERENCES"}</span><strong>{latestSourceCount.toLocaleString(language === "ar" ? "ar" : "en")}</strong><small>{language === "ar" ? "في آخر إجابة" : "in latest answer"}</small></article></section>
            <section className="workspace-insights"><div className="workspace-section-heading"><div><span>{language === "ar" ? "ذكاء المستند" : "DOCUMENT INTELLIGENCE"}</span><h2>{language === "ar" ? "لوحة الاكتشاف" : "Discovery board"}</h2></div>{latestInsightMessage && <span className="insight-live-dot">{language === "ar" ? "محدّث الآن" : "LIVE"}</span>}</div>
              {latestInsightMessage?.a2ui?.length ? <div className="workspace-widgets">{latestInsightMessage.a2ui.map(renderA2UISurface)}</div> : <div className="workspace-empty"><span className="workspace-empty-icon"><Sparkles size={18}/></span><strong>{language === "ar" ? "لوحتك جاهزة للاستكشاف" : "Your discovery board is ready"}</strong><p>{language === "ar" ? "اختر مرحلة من المسار أو اطرح سؤالاً. ستظهر هنا الرسوم، الأفكار، والاختبارات المستندة إلى الملف." : "Choose a journey stage or ask a question. Charts, insights, and quizzes grounded in your file will appear here."}</p></div>}
            </section>
            <footer className="workspace-foot"><ShieldCheck size={13}/>{language === "ar" ? "المحتوى والتحليلات مستندة إلى الملف المحدد فقط" : "Insights are grounded in the selected document only"}</footer>
          </div> : <div className="workspace-no-document"><div className="workspace-no-doc-icon"><FileText size={26}/></div><span>{language === "ar" ? "ابدأ بملفك الأول" : "START WITH A DOCUMENT"}</span><h2>{language === "ar" ? "كل المعرفة تبدأ من مصدر" : "Knowledge starts with a source"}</h2><p>{language === "ar" ? "ارفع ملف PDF لبناء مساحة استكشاف فيها إجابات ومراجع ورؤى تفاعلية." : "Upload a PDF to build an exploration space with grounded answers, references, and interactive insights."}</p><button type="button" onClick={()=>fileInputRef.current?.click()}><UploadCloud size={16}/>{language === "ar" ? "رفع ملف PDF" : "Upload a PDF"}</button></div>}
        </aside>
        </div>
      </main>
    </div>
  );
}
