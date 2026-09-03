export type Page =
  | "companies"
  | "tenant-metrics"
  | "team"
  | "connections"
  | "bot"
  | "knowledge"
  | "scheduling"
  | "requests"
  | "conversations";
export type KnowledgeSection =
  | "profile"
  | "catalog"
  | "requirements"
  | "responses"
  | "learning"
  | "answers"
  | "sources";
export const knowledgeSections: KnowledgeSection[] = [
  "profile",
  "catalog",
  "requirements",
  "responses",
  "learning",
  "answers",
  "sources",
];
export const knowledgePaths: Record<KnowledgeSection, string> = {
  profile: "/knowledge/profile",
  catalog: "/knowledge/catalog",
  requirements: "/knowledge/requirements",
  responses: "/knowledge/learned-responses",
  learning: "/knowledge/learning-queue",
  answers: "/knowledge/published-answers",
  sources: "/knowledge/sources",
};
export const pagePaths: Record<Page, string> = {
  companies: "/companies",
  "tenant-metrics": "/tenant-metrics",
  team: "/team",
  connections: "/connections",
  bot: "/bot",
  knowledge: knowledgePaths.profile,
  scheduling: "/scheduling",
  requests: "/orders-and-bookings",
  conversations: "/conversations",
};
export const knowledgeDescriptionKeys: Record<KnowledgeSection, string> = {
  profile: "pages.knowledge.description",
  catalog: "knowledge.catalogHelp",
  requirements: "requirements.description",
  responses: "knowledge.responseVariantsHelp",
  learning: "knowledge.learningHelp",
  answers: "knowledge.faqHelp",
  sources: "knowledge.sourcesHelp",
};
export const dashboardPages: Page[] = [
  "companies",
  "tenant-metrics",
  "team",
  "connections",
  "bot",
  "knowledge",
  "scheduling",
  "requests",
  "conversations",
];
export const readDashboardPage = (userId: string, fallback: Page): Page => {
  const saved = window.localStorage.getItem(
    `commerce.dashboard.page.${userId}`,
  ) as Page | null;
  return saved && dashboardPages.includes(saved) ? saved : fallback;
};
export const readDashboardTenant = (userId: string, fallback: string): string =>
  window.localStorage.getItem(`commerce.dashboard.tenant.${userId}`) ??
  fallback;
export const readDashboardRoute = (fallback: Page) => {
  const knowledgeSection = knowledgeSections.find(
    (section) => knowledgePaths[section] === window.location.pathname,
  );
  if (knowledgeSection) return { page: "knowledge" as Page, knowledgeSection };
  const page = dashboardPages.find(
    (candidate) => pagePaths[candidate] === window.location.pathname,
  );
  return { page: page ?? fallback, knowledgeSection: null };
};
